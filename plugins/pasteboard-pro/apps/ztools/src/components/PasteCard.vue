<script setup lang="ts">
import { computed } from "vue";

import type { PasteItem } from "@pasteboard-pro/core";

const props = defineProps<{
  item: PasteItem;
  selected: boolean;
  index: number;
}>();

const emit = defineEmits<{
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string];
  preview: [itemId: string];
}>();

const bodyText = computed(() => {
  if (props.item.payload.text !== undefined) return props.item.payload.text;
  if (props.item.payload.filePaths !== undefined) {
    return props.item.payload.filePaths.map((path) => path.split("/").pop() ?? path).join("\n");
  }
  if (props.item.ocrText !== undefined) return props.item.ocrText;
  return props.item.payload.mediaType ?? props.item.kind;
});
</script>

<template>
  <article
    class="paste-card"
    :class="[`paste-card--${item.kind}`, { 'paste-card--selected': selected }]"
    :aria-selected="selected"
    role="option"
    tabindex="0"
    @click="emit('select', item.id, $event.shiftKey, $event.metaKey)"
    @dblclick="emit('paste', item.id)"
    @keydown.enter="emit('paste', item.id)"
    @keydown.space.prevent="emit('preview', item.id)"
  >
    <header>
      <span class="kind">{{ item.kind.replace('_', ' ') }}</span>
      <kbd v-if="index < 9">{{ index + 1 }}</kbd>
    </header>
    <div v-if="item.kind === 'color'" class="color-preview" :style="{ background: item.payload.text }"></div>
    <div v-else-if="item.kind === 'image'" class="image-preview" aria-label="图片预览占位">
      <span>IMAGE</span>
    </div>
    <p v-else>{{ bodyText }}</p>
    <footer>
      <strong>{{ item.title ?? item.sourceApp?.name ?? "Untitled" }}</strong>
      <span>{{ item.sourceApp?.name ?? "Unknown app" }}</span>
    </footer>
  </article>
</template>

<style scoped>
.paste-card {
  display: grid;
  flex: 0 0 var(--pb-card-width);
  grid-template-rows: auto minmax(0, 1fr) auto;
  width: var(--pb-card-width);
  height: 142px;
  padding: 11px;
  overflow: hidden;
  border: 1px solid var(--pb-line);
  border-radius: 18px;
  background: color-mix(in srgb, var(--pb-glass-strong) 82%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--pb-shadow) 45%, transparent);
  cursor: default;
  outline: 0;
  transition: transform 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.paste-card:hover {
  transform: translateY(-2px);
}

.paste-card--selected,
.paste-card:focus-visible {
  border-color: color-mix(in srgb, var(--pb-violet) 72%, transparent);
  box-shadow:
    0 0 0 3px color-mix(in srgb, var(--pb-violet) 15%, transparent),
    0 12px 28px color-mix(in srgb, var(--pb-shadow) 55%, transparent);
}

header,
footer {
  display: flex;
  gap: 8px;
  align-items: center;
}

header {
  justify-content: space-between;
}

.kind {
  color: var(--pb-violet);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

kbd {
  display: grid;
  width: 18px;
  height: 18px;
  border: 1px solid var(--pb-line);
  border-radius: 6px;
  color: var(--pb-muted);
  font-size: 9px;
  place-items: center;
}

p {
  display: -webkit-box;
  margin: 10px 0;
  overflow: hidden;
  color: var(--pb-ink);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.color-preview,
.image-preview {
  min-height: 62px;
  margin: 8px 0;
  border-radius: 11px;
}

.image-preview {
  display: grid;
  background:
    radial-gradient(circle at 28% 30%, rgba(255, 255, 255, 0.7), transparent 30%),
    linear-gradient(135deg, #8e82e8, #423c72);
  color: rgba(255, 255, 255, 0.72);
  font-size: 9px;
  font-weight: 750;
  letter-spacing: 0.18em;
  place-items: center;
}

footer {
  min-width: 0;
  justify-content: space-between;
  color: var(--pb-muted);
  font-size: 9px;
}

footer strong,
footer span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

footer strong {
  color: var(--pb-ink);
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .paste-card {
    transition: none;
  }
}
</style>
