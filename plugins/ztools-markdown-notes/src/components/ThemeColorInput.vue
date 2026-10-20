<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { normalizeHexColor } from '../themes'

const props = defineProps<{ modelValue: string; label: string; fieldId: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const normalized = computed(() => normalizeHexColor(props.modelValue))
const lastValid = ref(normalized.value ?? '#000000')
watch(normalized, (value) => { if (value) lastValid.value = value })

function update(event: Event) {
  if (event.target instanceof HTMLInputElement) emit('update:modelValue', event.target.value)
}
</script>

<template>
  <div class="theme-color-field">
    <label :for="fieldId">{{ label }}</label>
    <div class="theme-color-controls">
      <input type="color" :value="lastValid" :aria-label="`${label}颜色选择器`" @input="update" />
      <input :id="fieldId" type="text" :value="modelValue" spellcheck="false" autocomplete="off"
        :aria-invalid="!normalized" :aria-describedby="!normalized ? `${fieldId}-error` : undefined"
        placeholder="#RRGGBB" @input="update" />
    </div>
    <small v-if="!normalized" :id="`${fieldId}-error`" class="theme-field-error">请输入六位十六进制颜色，可带 #</small>
  </div>
</template>

<style scoped>
.theme-color-field { display: grid; gap: 6px; min-width: 0; }
.theme-color-field label { font-size: 13px; }
.theme-color-controls { display: flex; gap: 8px; align-items: center; }
.theme-color-controls input[type="color"] { width: 40px; height: 34px; padding: 2px; cursor: pointer; flex: none; }
.theme-color-controls input[type="text"] { width: 100%; min-width: 0; font-family: monospace; }
.theme-color-controls input[aria-invalid="true"] { border-color: #d64b4b; }
.theme-field-error { color: #d64b4b; font-size: 12px; }
</style>
