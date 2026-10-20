import type { FieldDef, Row, TableSchema } from '../types/table.ts'
import {
  CREATED_AT_FIELD_ID,
  UPDATED_AT_FIELD_ID,
  isMultiValue,
  isSystemFieldId
} from '../types/table.ts'
import { displayValue } from './fieldTypes.ts'
import { formatTimestamp } from '../utils/time.ts'

/** 列宽上下限（px）：下限保证表头可读，上限避免长文本一列吃满整个表格 */
export const COLUMN_WIDTH_MIN = 96
export const COLUMN_WIDTH_MAX = 360

/** 半角字符在 14px 字体下的估算宽度 */
const HALF_CHAR_PX = 7
/** 单元格左右内边距（对齐 .el-table .cell 的 padding: 0 12px）+ 余量 */
const CELL_PADDING_PX = 32
/** 表头额外占用：排序箭头 */
const HEADER_EXTRA_PX = 26
/** 标签（el-tag small）每个取值的额外占用：内边距 + 间距 */
const TAG_CHROME_PX = 22
/** 每个单元格只扫前 N 个字符：再长的内容也必定超过 COLUMN_WIDTH_MAX，不必整串扫完 */
const SCAN_LIMIT = 120

/** 全角 / CJK 字符判定（按 charCode 估算；代理对按两个半角字符计，误差被上限截断吸收） */
function isWideChar(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

/**
 * 文本显示宽度（单位：半角字符宽），CJK / 全角符号按 2 计。
 * 超过 SCAN_LIMIT 的字符不再计入：截断处也至少有 SCAN_LIMIT 个单位宽，
 * 换算后必定超过 COLUMN_WIDTH_MAX，不会把宽内容低估到上限以内。
 */
export function displayWidthUnits(text: string): number {
  const end = Math.min(text.length, SCAN_LIMIT)
  let units = 0
  for (let i = 0; i < end; i++) {
    units += isWideChar(text.charCodeAt(i)) ? 2 : 1
  }
  return units
}

/** 单元格展示文本：系统时间列取格式化时间，其余取字段展示值（与表格渲染保持一致） */
export function cellTextOf(field: FieldDef, row: Row, multiSep = '、'): string {
  if (field.id === CREATED_AT_FIELD_ID) return formatTimestamp(row.createdAt)
  if (field.id === UPDATED_AT_FIELD_ID) return formatTimestamp(row.updatedAt)
  return displayValue(field, row.values[field.id], multiSep)
}

/** 一行内容需要的像素宽度（含单元格内边距；多值字段按标签逐个累加） */
function contentPx(field: FieldDef, row: Row, multiSep: string): number {
  if (isMultiValue(field)) {
    const v = row.values[field.id]
    if (!Array.isArray(v) || !v.length) return 0
    let px = CELL_PADDING_PX
    for (const item of v) px += displayWidthUnits(String(item)) * HALF_CHAR_PX + TAG_CHROME_PX
    return px
  }
  return displayWidthUnits(cellTextOf(field, row, multiSep)) * HALF_CHAR_PX + CELL_PADDING_PX
}

function clampWidth(px: number): number {
  if (px < COLUMN_WIDTH_MIN) return COLUMN_WIDTH_MIN
  if (px > COLUMN_WIDTH_MAX) return COLUMN_WIDTH_MAX
  return Math.round(px)
}

/**
 * 估算一列的默认宽度（px）：表头（含排序箭头）与内容里最宽的取值取较大者，夹在 [MIN, MAX]。
 * rows 传采样后的行即可——「看多少行」由调用方决定，函数本身不截断。
 */
export function estimateColumnWidth(field: FieldDef, rows: Row[], multiSep = '、'): number {
  const headerPx = displayWidthUnits(field.name) * HALF_CHAR_PX + CELL_PADDING_PX + HEADER_EXTRA_PX
  let widestPx = 0
  for (const row of rows) {
    const px = contentPx(field, row, multiSep)
    if (px > widestPx) widestPx = px
  }
  return clampWidth(Math.max(headerPx, widestPx))
}

/** 记下的列宽是否可用（导入的备份里可能带脏数据） */
export function isValidColumnWidth(width: unknown): width is number {
  return typeof width === 'number' && Number.isFinite(width) && width > 0
}

/** 删除字段后清掉它留下的列宽记录（系统时间列始终保留；脏值一并丢弃） */
export function pruneColumnWidths(schema: TableSchema): TableSchema {
  const widths = schema.columnWidths
  if (!widths) return schema
  const kept: Record<string, number> = {}
  for (const [id, w] of Object.entries(widths)) {
    if (!isValidColumnWidth(w)) continue
    if (isSystemFieldId(id) || schema.fields.some((f) => f.id === id)) kept[id] = Math.round(w)
  }
  return { ...schema, columnWidths: Object.keys(kept).length ? kept : undefined }
}