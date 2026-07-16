<script setup lang="ts">
import type { PasteItem } from "@pasteboard-pro/core";

import PasteCard from "./PasteCard.vue";

defineProps<{
  items: readonly PasteItem[];
  selectedIds: readonly string[];
}>();

const emit = defineEmits<{
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
}>();

function forwardSelect(itemId: string, extend: boolean, toggle: boolean): void {
  emit("select", itemId, extend, toggle);
}
</script>

<template>
  <section class="timeline" aria-label="剪贴板时间线">
    <div v-if="items.length === 0" class="empty-state" aria-live="polite">
      <span>LOCAL HISTORY</span>
      <strong>复制内容后会出现在这里</strong>
      <p>PasteboardPro 只保存通过隐私规则的本地记录。</p>
    </div>
    <div v-else class="timeline__track" role="listbox" aria-multiselectable="true">
      <PasteCard
        v-for="(item, index) in items"
        :key="item.id"
        :item="item"
        :index="index"
        :selected="selectedIds.includes(item.id)"
        @select="forwardSelect"
        @paste="emit('paste', $event)"
        @preview="emit('preview', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.timeline {
  min-height: 158px;
  padding: 8px 16px 16px;
  overflow: hidden;
}

.timeline__track {
  display: flex;
  gap: 12px;
  min-height: 150px;
  padding: 4px 3px 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-color: color-mix(in srgb, var(--pb-violet) 30%, transparent) transparent;
  scrollbar-width: thin;
}

.timeline__track > * {
  scroll-snap-align: start;
}

.empty-state {
  display: grid;
  min-height: 142px;
  place-content: center;
  justify-items: center;
  color: var(--pb-muted);
  text-align: center;
}

.empty-state span {
  color: var(--pb-violet);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.16em;
}

.empty-state strong {
  margin-top: 7px;
  color: var(--pb-ink);
  font-size: 15px;
}

.empty-state p {
  margin: 4px 0 0;
  font-size: 11px;
}
</style>
