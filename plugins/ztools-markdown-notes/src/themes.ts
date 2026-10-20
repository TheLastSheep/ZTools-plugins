export type ThemeColors = {
  navigationBackground: string
  navigationText: string
  editorBackground: string
  editorText: string
  editorToolbarBackground: string
  popupBackground: string
  popupText: string
  accentColor: string
  borderColor: string
  textHighlightColor: string
  findHighlightColor: string
}

export type ColorTheme = { id: string; name: string; colors: ThemeColors }
export const builtInThemeIds = ['blue', 'black', 'white'] as const
export const themeColorKeys = [
  'navigationBackground', 'navigationText', 'editorBackground', 'editorText',
  'editorToolbarBackground', 'popupBackground', 'popupText', 'accentColor',
  'borderColor', 'textHighlightColor', 'findHighlightColor',
] as const satisfies readonly (keyof ThemeColors)[]

const lightColors: ThemeColors = {
  navigationBackground: '#FFFFFF',
  navigationText: '#172033',
  editorBackground: '#FFFFFF',
  editorText: '#172033',
  editorToolbarBackground: '#F6F8FA',
  popupBackground: '#FFFFFF',
  popupText: '#172033',
  accentColor: '#2563EB',
  borderColor: '#DCE4F0',
  textHighlightColor: '#FACC15',
  findHighlightColor: '#FACC15',
}
const blueDarkColors: ThemeColors = {
  navigationBackground: '#182235',
  navigationText: '#FFFFFF',
  editorBackground: '#182235',
  editorText: '#EDF4FF',
  editorToolbarBackground: '#151E2E',
  popupBackground: '#182235',
  popupText: '#FFFFFF',
  accentColor: '#3B82F6',
  borderColor: '#2B3A50',
  textHighlightColor: '#FACC15',
  findHighlightColor: '#FACC15',
}
const blackColors: ThemeColors = {
  ...blueDarkColors,
  navigationBackground: '#1A1A1A',
  navigationText: '#F1F1F1',
  editorBackground: '#1A1A1A',
  editorText: '#F1F1F1',
  editorToolbarBackground: '#151515',
  popupBackground: '#1A1A1A',
  popupText: '#F1F1F1',
  borderColor: '#333333',
}

export function getBuiltInThemes(systemDark: boolean): ColorTheme[] {
  return [
    { id: 'blue', name: '蓝底', colors: { ...(systemDark ? blueDarkColors : lightColors) } },
    { id: 'black', name: '黑底', colors: { ...blackColors } },
    { id: 'white', name: '白底', colors: { ...lightColors } },
  ]
}

export function resolveTheme(themeId: string, customThemes: ColorTheme[], systemDark: boolean): ColorTheme {
  const builtIns = getBuiltInThemes(systemDark)
  const theme = builtIns.find((item) => item.id === themeId)
    ?? customThemes.find((item) => item.id === themeId)
    ?? builtIns[0]!
  return { ...theme, colors: { ...theme.colors } }
}

export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i)
  return match ? `#${match[1]!.toUpperCase()}` : null
}

export function isDarkColor(color: string): boolean {
  const normalized = normalizeHexColor(color)
  if (!normalized) return false
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722 < 0.179
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function normalizeCustomThemes(value: unknown): ColorTheme[] {
  if (!Array.isArray(value)) return []
  const themes: ColorTheme[] = []
  const ids = new Set<string>()
  const names = new Set(getBuiltInThemes(false).map((theme) => theme.name.toLowerCase()))
  for (const item of value) {
    if (!isPlainRecord(item) || !Object.hasOwn(item, 'id') || !Object.hasOwn(item, 'name') || !Object.hasOwn(item, 'colors')) continue
    if (typeof item.id !== 'string' || !/^custom:[a-z0-9][a-z0-9_-]*$/i.test(item.id) || ids.has(item.id)) continue
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 40 || !isPlainRecord(item.colors)) continue
    const name = item.name.trim()
    const normalizedName = name.toLowerCase()
    if (names.has(normalizedName)) continue
    const colors: ThemeColors = { ...lightColors }
    let valid = true
    for (const key of themeColorKeys) {
      const color = Object.hasOwn(item.colors, key) ? normalizeHexColor(item.colors[key]) : null
      if (!color) { valid = false; break }
      colors[key] = color
    }
    if (!valid) continue
    themes.push({ id: item.id, name, colors })
    ids.add(item.id)
    names.add(normalizedName)
  }
  return themes
}
