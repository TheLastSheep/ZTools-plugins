<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { getBuiltInThemes, isDarkColor, normalizeHexColor, type ColorTheme, type ThemeColors } from '../themes'
import ThemeColorInput from './ThemeColorInput.vue'

const props = defineProps<{
  activeTheme: ColorTheme
  customThemes: ColorTheme[]
  systemDark: boolean
  saveTheme?: (theme: ColorTheme) => boolean
  deleteTheme?: (id: string) => boolean
}>()
const emit = defineEmits<{
  select: [id: string]
  save: [theme: ColorTheme]
  delete: [id: string]
  preview: [theme: ColorTheme | null]
}>()

const picker = ref<HTMLSelectElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const deleteButton = ref<HTMLButtonElement | null>(null)
const draft = ref<ColorTheme | null>(null)
const pendingDelete = ref<ColorTheme | null>(null)
const showDetails = ref(false)
const persistenceError = ref('')
const explicitlyEdited = new Set<keyof ThemeColors>()
const builtIns = computed(() => getBuiltInThemes(props.systemDark))
const themes = computed(() => [...builtIns.value, ...props.customThemes])
const isCustom = computed(() => props.customThemes.some((theme) => theme.id === props.activeTheme.id))
type ColorField = { key: keyof ThemeColors; label: string }
const basicFields: ColorField[] = [
  { key: 'navigationBackground', label: '导航背景' },
  { key: 'editorBackground', label: '正文背景' },
  { key: 'popupBackground', label: '弹窗背景' },
  { key: 'textHighlightColor', label: '文本高亮' },
  { key: 'findHighlightColor', label: '查找匹配' },
]
const detailFields: ColorField[] = [
  { key: 'navigationText', label: '导航文字' },
  { key: 'editorText', label: '正文文字' },
  { key: 'popupText', label: '弹窗文字' },
  { key: 'editorToolbarBackground', label: '编辑器工具栏背景' },
  { key: 'accentColor', label: '强调色' },
  { key: 'borderColor', label: '边框颜色' },
]
const nameError = computed(() => {
  if (!draft.value) return ''
  const name = draft.value.name.trim()
  if (!name || name.length > 40) return '主题名称需为 1–40 个字符'
  if (themes.value.some((theme) => theme.id !== draft.value?.id && theme.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) return '已有同名主题，请使用其他名称'
  return ''
})
const normalizedColors = computed(() => {
  if (!draft.value) return null
  const colors = { ...draft.value.colors }
  for (const field of [...basicFields, ...detailFields]) {
    const normalized = normalizeHexColor(colors[field.key])
    if (!normalized) return null
    colors[field.key] = normalized
  }
  return colors
})
const canSave = computed(() => !!draft.value && !nameError.value && !!normalizedColors.value)

watch(normalizedColors, (colors) => {
  if (colors && draft.value) emit('preview', { ...draft.value, colors: { ...colors } })
}, { deep: true })

function suggestedCopyName() {
  const existing = new Set(themes.value.map((theme) => theme.name.trim().toLocaleLowerCase()))
  const base = props.activeTheme.name.slice(0, 32)
  let name = `${base} 副本`
  let suffix = 2
  while (existing.has(name.toLocaleLowerCase())) name = `${base} 副本 ${suffix++}`
  return name
}

function openEditor(mode: 'create' | 'copy' | 'edit') {
  if (mode === 'edit' && !isCustom.value) return
  persistenceError.value = ''
  explicitlyEdited.clear()
  draft.value = {
    id: mode === 'edit' ? props.activeTheme.id : `custom:${crypto.randomUUID()}`,
    name: mode === 'edit' ? props.activeTheme.name : mode === 'copy' ? suggestedCopyName() : '',
    colors: { ...props.activeTheme.colors },
  }
  showDetails.value = false
  nextTick(() => { nameInput.value?.focus(); nameInput.value?.select() })
}

function updateColor(key: keyof ThemeColors, value: string) {
  if (!draft.value) return
  draft.value.colors[key] = value
  if (detailFields.some((field) => field.key === key)) explicitlyEdited.add(key)
  const background = normalizeHexColor(value)
  if (!background) return
  const textKey = key === 'navigationBackground' ? 'navigationText'
    : key === 'editorBackground' ? 'editorText'
      : key === 'popupBackground' ? 'popupText' : null
  if (textKey && !explicitlyEdited.has(textKey)) {
    draft.value.colors[textKey] = isDarkColor(background) ? '#FFFFFF' : '#172033'
  }
  if (key === 'editorBackground' && !explicitlyEdited.has('editorToolbarBackground')) {
    draft.value.colors.editorToolbarBackground = background
  }
}

function selectTheme(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return
  const id = event.target.value
  if (id === '__create__') {
    event.target.value = props.activeTheme.id
    openEditor('create')
  } else {
    emit('select', id)
    nextTick(() => { if (picker.value) picker.value.value = props.activeTheme.id })
  }
}

function closeEditor() {
  draft.value = null
  emit('preview', null)
  nextTick(() => picker.value?.focus())
}

function saveDraft() {
  if (!draft.value || !canSave.value || !normalizedColors.value) return
  const theme = { id: draft.value.id, name: draft.value.name.trim(), colors: { ...normalizedColors.value } }
  if (props.saveTheme && !props.saveTheme(theme)) {
    persistenceError.value = '主题保存失败，当前修改已保留，请重试。'
    return
  }
  emit('save', theme)
  closeEditor()
}

function requestDelete() {
  if (!isCustom.value) return
  persistenceError.value = ''
  pendingDelete.value = { ...props.activeTheme, colors: { ...props.activeTheme.colors } }
  nextTick(() => deleteButton.value?.focus())
}

function closeDelete() {
  pendingDelete.value = null
  nextTick(() => picker.value?.focus())
}

function confirmDelete() {
  if (!pendingDelete.value) return
  if (props.deleteTheme && !props.deleteTheme(pendingDelete.value.id)) {
    persistenceError.value = '主题删除失败，请重试。'
    return
  }
  emit('delete', pendingDelete.value.id)
  closeDelete()
}

function handleShortcut(event: KeyboardEvent): boolean {
  if (!draft.value && !pendingDelete.value) return false
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (pendingDelete.value) closeDelete()
    else closeEditor()
  } else if (event.ctrlKey && event.key.toLowerCase() === 's') {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (!pendingDelete.value) saveDraft()
  }
  return true
}

function cancelPreview() {
  pendingDelete.value = null
  closeEditor()
}

onBeforeUnmount(() => emit('preview', null))
defineExpose({ handleShortcut, cancelPreview })
</script>

<template>
  <div class="theme-settings">
    <label for="appearance-theme-picker">配色主题</label>
    <select id="appearance-theme-picker" ref="picker" :value="activeTheme.id" @change="selectTheme">
      <option v-for="theme in themes" :key="theme.id" :value="theme.id">{{ theme.name }}</option>
      <option value="__create__">＋ 创建主题</option>
    </select>
    <div class="theme-settings-actions">
      <button type="button" @click="openEditor('copy')">复制</button>
      <button type="button" :disabled="!isCustom" @click="openEditor('edit')">编辑</button>
      <button type="button" :disabled="!isCustom" @click="requestDelete">删除</button>
    </div>
    <small>内置主题可复制后修改；蓝底跟随系统明暗。</small>
  </div>

  <Teleport to="body">
    <div v-if="draft" class="modal-backdrop theme-editor-backdrop" @click.self="closeEditor" @keydown.stop>
      <form class="settings-dialog theme-editor-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-editor-title" @submit.prevent="saveDraft">
        <header class="theme-dialog-header">
          <h2 id="theme-editor-title">{{ customThemes.some((theme) => theme.id === draft?.id) ? '编辑主题' : '创建主题' }}</h2>
          <button type="button" aria-label="关闭主题编辑" @click="closeEditor">×</button>
        </header>
        <div class="theme-dialog-content">
          <label class="theme-name-field" for="theme-name">主题名称
            <input id="theme-name" ref="nameInput" v-model="draft.name" type="text" autocomplete="off" :aria-invalid="!!nameError" :aria-describedby="nameError ? 'theme-name-error' : undefined" />
          </label>
          <small v-if="nameError" id="theme-name-error" class="theme-field-error">{{ nameError }}</small>
          <p class="theme-preview-note">颜色修改会即时预览，保存后才会加入主题列表。</p>
          <p class="theme-preview-note">修改背景时自动搭配文字颜色，也可在详细颜色中调整。</p>
          <div class="theme-color-grid">
            <ThemeColorInput v-for="field in basicFields" :key="field.key" :model-value="draft.colors[field.key]" :label="field.label" :field-id="`theme-${field.key}`" @update:model-value="updateColor(field.key, $event)" />
          </div>
          <button type="button" class="theme-details-toggle" :aria-expanded="showDetails" aria-controls="theme-color-details" @click="showDetails = !showDetails">{{ showDetails ? '收起详细颜色' : '展开详细颜色' }}</button>
          <div v-show="showDetails" id="theme-color-details" class="theme-color-grid">
            <ThemeColorInput v-for="field in detailFields" :key="field.key" :model-value="draft.colors[field.key]" :label="field.label" :field-id="`theme-${field.key}`" @update:model-value="updateColor(field.key, $event)" />
          </div>
          <p v-if="!normalizedColors" class="theme-field-error" role="status">请修正颜色输入后保存。</p>
          <p v-if="persistenceError" class="theme-field-error" role="alert">{{ persistenceError }}</p>
        </div>
        <footer class="theme-dialog-actions">
          <button type="button" @click="closeEditor">取消</button>
          <button type="submit" :disabled="!canSave">保存主题</button>
        </footer>
      </form>
    </div>
    <div v-if="pendingDelete" class="modal-backdrop theme-editor-backdrop" @click.self="closeDelete" @keydown.stop>
      <section class="settings-dialog theme-editor-dialog theme-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="theme-delete-title">
        <h2 id="theme-delete-title">删除主题</h2>
        <p>确定删除“{{ pendingDelete.name }}”？正在使用此主题时会切换回蓝底。</p>
        <p v-if="persistenceError" class="theme-field-error" role="alert">{{ persistenceError }}</p>
        <footer class="theme-dialog-actions">
          <button ref="deleteButton" type="button" @click="closeDelete">取消</button>
          <button type="button" @click="confirmDelete">删除主题</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.theme-settings { display: grid; gap: 8px; }
.theme-settings select { width: 100%; }
.theme-settings small, .theme-preview-note { opacity: .75; font-size: 12px; line-height: 1.5; }
.theme-settings-actions, .theme-dialog-actions { display: flex; gap: 8px; }
.theme-editor-backdrop { z-index: 150; padding: 16px; }
.theme-editor-dialog { display: flex; flex-direction: column; width: min(580px, 100%); max-height: calc(100vh - 32px); overflow: hidden; }
.theme-dialog-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
.theme-dialog-header h2 { margin: 0; font-size: 18px; }
.theme-dialog-content { overflow-y: auto; padding: 16px 2px; min-height: 0; }
.theme-name-field { display: grid; gap: 8px; }
.theme-color-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.theme-details-toggle { margin: 18px 0; }
.theme-dialog-actions { justify-content: flex-end; padding-top: 12px; }
.theme-field-error { color: #d64b4b; font-size: 12px; }
.theme-name-field input[aria-invalid="true"] { border-color: #d64b4b; }
.theme-delete-dialog { max-width: 420px; }
@media (max-width: 420px) { .theme-color-grid { grid-template-columns: 1fr; } }
</style>
