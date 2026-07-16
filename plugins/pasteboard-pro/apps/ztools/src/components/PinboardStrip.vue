<script setup lang="ts">
import type { Pinboard } from "@pasteboard-pro/core";

defineProps<{ pinboards: readonly Pinboard[]; activeId: string | undefined }>();
const emit = defineEmits<{ select: [id: string | undefined] }>();
</script>

<template>
  <nav class="pinboards" aria-label="Pinboards">
    <button
      type="button"
      :class="{ active: activeId === undefined }"
      @click="emit('select', undefined)"
    >
      全部
    </button>
    <button
      v-for="pinboard in pinboards"
      :key="pinboard.id"
      type="button"
      :class="{ active: activeId === pinboard.id }"
      @click="emit('select', pinboard.id)"
    >
      <span class="dot" :style="{ background: pinboard.color }"></span>
      {{ pinboard.name }}
    </button>
    <span class="pinboards__hint">⌘ 1–9 Quick Paste</span>
  </nav>
</template>

<style scoped>
.pinboards {
  display: flex;
  gap: 6px;
  align-items: center;
  min-height: 38px;
  padding: 6px 16px 4px;
  overflow-x: auto;
  scrollbar-width: none;
}

.pinboards::-webkit-scrollbar {
  display: none;
}

button {
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--pb-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
}

button.active {
  background: color-mix(in srgb, var(--pb-violet) 13%, transparent);
  color: var(--pb-violet);
}

button:focus-visible {
  outline: 2px solid var(--pb-violet);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.pinboards__hint {
  margin-left: auto;
  padding-left: 16px;
  color: var(--pb-muted);
  font-size: 10px;
  white-space: nowrap;
}
</style>
