<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

import { historyFixture, pinboardFixture } from "@pasteboard-pro/contract-fixtures";
import type { Pinboard } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import Shelf from "./components/Shelf.vue";
import { createPasteboardState, type PasteboardKeyboardEffect } from "./state";

const params = new URLSearchParams(window.location.search);
const dockValue = params.get("dock");
const edge: DockEdge =
  dockValue === "bottom" || dockValue === "left" || dockValue === "right"
    ? dockValue
    : "floating";

const developmentItems = import.meta.env.DEV ? historyFixture : [];
const developmentPinboards = import.meta.env.DEV ? pinboardFixture : [];
const state = reactive(
  createPasteboardState({
    items: developmentItems,
    dockEdge: edge,
  }),
);
const pinboards = ref<Pinboard[]>(
  developmentPinboards.map((pinboard) => structuredClone(pinboard)),
);
const query = ref("");
const paused = ref(false);
const activePinboardId = ref<string>();
const previewItemId = ref<string>();
const status = ref("本地历史已就绪");

const visibleItems = computed(() => {
  const items = state.visibleItems;
  return activePinboardId.value === undefined
    ? items
    : items.filter((item) => item.pinboardId === activePinboardId.value);
});
const previewItem = computed(() =>
  visibleItems.value.find((item) => item.id === previewItemId.value),
);

function updateQuery(value: string): void {
  query.value = value;
  state.setQuery(value);
}

function selectItem(itemId: string, extend: boolean, toggle: boolean): void {
  if (extend) {
    state.extendSelectionTo(itemId);
    return;
  }
  if (toggle) {
    state.toggleSelection(itemId);
    return;
  }
  state.replaceSelection(itemId);
}

async function pasteItem(itemId: string): Promise<void> {
  const item = visibleItems.value.find((candidate) => candidate.id === itemId);
  if (item === undefined) return;
  try {
    const result = await window.pasteboardPro?.pasteItem(itemId);
    status.value =
      result?.status === "accessibility_required"
        ? "已复制；授权辅助功能后可直接粘贴"
        : `已粘贴：${item.title ?? item.kind}`;
  } catch (error) {
    status.value = error instanceof Error ? error.message : "粘贴失败";
  }
}

function handleEffect(effect: PasteboardKeyboardEffect | null): void {
  if (effect === null) return;
  if (effect.type === "preview") {
    previewItemId.value = effect.itemId;
    return;
  }
  const itemId = effect.type === "quick-paste" ? effect.itemId : effect.itemIds[0];
  if (itemId !== undefined) void pasteItem(itemId);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  const effect = state.handleKeyboard({
    key: event.key,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
  });
  if (effect !== null || ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape"].includes(event.key)) {
    event.preventDefault();
  }
  handleEffect(effect);
}

async function togglePause(): Promise<void> {
  const next = !paused.value;
  const settings = await window.pasteboardPro?.setCapturePause({ paused: next });
  paused.value = settings?.pause.paused ?? next;
  status.value = paused.value ? "剪贴板捕获已暂停" : "剪贴板捕获已继续";
}

function onMirrored(event: Event): void {
  const detail = (event as CustomEvent<{ imported: number }>).detail;
  status.value = detail.imported > 0 ? `已导入 ${detail.imported} 条记录` : "历史已同步";
}

async function loadHistory(): Promise<void> {
  const history = await window.pasteboardPro?.searchHistory("", 10_000);
  if (history !== undefined) {
    state.replaceItems(history.items);
    status.value = `已载入 ${history.total} 条记录`;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pasteboard-pro:history-mirrored", onMirrored);
  window.addEventListener("pasteboard-pro:history-changed", loadHistory);
  const settings = await window.pasteboardPro?.getPrivacySettings();
  paused.value = settings?.pause.paused ?? false;
  await loadHistory();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("pasteboard-pro:history-mirrored", onMirrored);
  window.removeEventListener("pasteboard-pro:history-changed", loadHistory);
});
</script>

<template>
  <main class="stage">
    <Shelf
      :items="visibleItems"
      :pinboards="pinboards"
      :selected-ids="state.selection.selected"
      :query="query"
      :paused="paused"
      :edge="state.dockEdge"
      :density="state.density"
      :active-pinboard-id="activePinboardId"
      :preview-item="previewItem"
      :paste-stack-count="state.pasteStack.itemIds.length"
      :paste-stack-direction="state.pasteStack.direction"
      @update:query="updateQuery"
      @select="selectItem"
      @paste="pasteItem"
      @preview="previewItemId = $event"
      @close-preview="previewItemId = undefined"
      @select-pinboard="activePinboardId = $event"
      @toggle-pause="togglePause"
      @toggle-compact="state.setDensity(state.density === 'compact' ? 'expanded' : 'compact')"
      @toggle-stack-direction="state.dispatchPasteStack({ type: 'set-direction', direction: state.pasteStack.direction === 'forward' ? 'reverse' : 'forward' })"
      @clear-stack="state.dispatchPasteStack({ type: 'clear' })"
    />
    <p class="status" aria-live="polite">{{ status }}</p>
  </main>
</template>

<style>
@import "./styles/tokens.css";
@import "./styles/glass.css";
@import "./styles/layout.css";

.stage {
  display: grid;
  min-height: 100%;
  padding: 12px;
  place-items: end center;
}

.status {
  position: fixed;
  left: 50%;
  bottom: 2px;
  margin: 0;
  color: var(--pb-muted);
  font-size: 9px;
  transform: translateX(-50%);
}

body:has(.shelf--bottom) .stage {
  padding-bottom: 0;
}

body:has(.shelf--left) .stage {
  padding-left: 0;
  place-items: center start;
}

body:has(.shelf--right) .stage {
  padding-right: 0;
  place-items: center end;
}
</style>
