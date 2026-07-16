<script setup lang="ts">
import type { PasteItem } from "@pasteboard-pro/core";

defineProps<{ item: PasteItem }>();
const emit = defineEmits<{ close: []; paste: [itemId: string] }>();
</script>

<template>
  <aside class="preview" aria-label="内容预览">
    <header>
      <div>
        <span>{{ item.kind }}</span>
        <strong>{{ item.title ?? "Preview" }}</strong>
      </div>
      <button type="button" aria-label="关闭预览" @click="emit('close')">×</button>
    </header>
    <pre>{{ item.payload.text ?? item.ocrText ?? item.payload.filePaths?.join('\n') ?? item.payload.mediaType }}</pre>
    <footer>
      <span>{{ item.sourceApp?.name ?? "Unknown app" }}</span>
      <button type="button" @click="emit('paste', item.id)">粘贴</button>
    </footer>
  </aside>
</template>

<style scoped>
.preview {
  position: absolute;
  z-index: 5;
  top: 68px;
  right: 14px;
  bottom: 14px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(360px, calc(100% - 28px));
  padding: 14px;
  border: 1px solid var(--pb-line);
  border-radius: 20px;
  background: color-mix(in srgb, var(--pb-glass-strong) 94%, transparent);
  box-shadow: 0 24px 60px var(--pb-shadow);
  backdrop-filter: blur(30px);
}

header,
footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

header div {
  display: grid;
  gap: 2px;
}

header span {
  color: var(--pb-violet);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

header strong {
  font-size: 14px;
}

button {
  border: 1px solid var(--pb-line);
  border-radius: 10px;
  background: var(--pb-glass);
  cursor: pointer;
}

header button {
  width: 28px;
  height: 28px;
  font-size: 18px;
}

pre {
  margin: 14px 0;
  overflow: auto;
  color: var(--pb-ink);
  font: 12px/1.5 "SFMono-Regular", Consolas, monospace;
  white-space: pre-wrap;
}

footer {
  color: var(--pb-muted);
  font-size: 10px;
}

footer button {
  min-height: 32px;
  padding: 0 16px;
  background: var(--pb-violet);
  color: white;
}
</style>
