<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";

import { historyFixture, pinboardFixture } from "@pasteboard-pro/contract-fixtures";
import { PinboardSchema, type Pinboard } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";
import type { SaveSyncConfigurationInput } from "../preload/sync-config";
import { defaultSyncSettings, type SyncSettings } from "../preload/sync-store";

import Shelf from "./components/Shelf.vue";
import SyncSettingsPanel from "./components/SyncSettings.vue";
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
const syncSettings = ref<SyncSettings>(structuredClone(defaultSyncSettings));
const syncSettingsOpen = ref(false);
const syncSettingsSaving = ref(false);

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

async function loadPinboards(): Promise<void> {
  const values = await window.pasteboardPro?.listPinboards();
  if (values !== undefined) {
    pinboards.value = values.map((value) => PinboardSchema.parse(value));
  }
}

async function createPinboard(name: string): Promise<void> {
  await window.pasteboardPro?.createPinboard(name, "#6F61EA");
  await loadPinboards();
  status.value = `已创建 Pinboard：${name}`;
}

async function renamePinboard(id: string, name: string): Promise<void> {
  await window.pasteboardPro?.renamePinboard(id, name);
  await loadPinboards();
  status.value = `已重命名 Pinboard：${name}`;
}

async function assignPinboard(
  pinboardId: string | undefined,
  draggedItemId: string,
): Promise<void> {
  const itemIds = state.selection.selected.includes(draggedItemId)
    ? state.selection.selected
    : [draggedItemId];
  await window.pasteboardPro?.assignItemsToPinboard(itemIds, pinboardId);
  await loadHistory();
  status.value =
    pinboardId === undefined
      ? `已将 ${itemIds.length} 项移出 Pinboard`
      : `已将 ${itemIds.length} 项加入 Pinboard`;
}

async function recognizeItem(itemId: string): Promise<void> {
  status.value = "正在识别图片文字…";
  try {
    const text = await window.pasteboardPro?.recognizeItem(itemId);
    await loadHistory();
    status.value = text ? "OCR 识别完成" : "未识别到文字";
  } catch (error) {
    status.value = error instanceof Error ? error.message : "OCR 识别失败";
  }
}

async function openSyncSettings(): Promise<void> {
  syncSettings.value =
    (await window.pasteboardPro?.getSyncSettings()) ?? structuredClone(defaultSyncSettings);
  syncSettingsOpen.value = true;
}

async function saveSyncSettings(input: SaveSyncConfigurationInput): Promise<void> {
  syncSettingsSaving.value = true;
  try {
    const saved = await window.pasteboardPro?.saveSyncSettings(input);
    if (saved !== undefined) syncSettings.value = saved;
    status.value = input.enabled ? "同步设置已保存" : "云同步已关闭";
    syncSettingsOpen.value = false;
  } catch (error) {
    status.value = error instanceof Error ? error.message : "同步设置保存失败";
  } finally {
    syncSettingsSaving.value = false;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("pasteboard-pro:history-mirrored", onMirrored);
  window.addEventListener("pasteboard-pro:history-changed", loadHistory);
  const settings = await window.pasteboardPro?.getPrivacySettings();
  paused.value = settings?.pause.paused ?? false;
  await loadHistory();
  await loadPinboards();
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
      @ocr="recognizeItem"
      @close-preview="previewItemId = undefined"
      @select-pinboard="activePinboardId = $event"
      @create-pinboard="createPinboard"
      @rename-pinboard="renamePinboard"
      @assign-pinboard="assignPinboard"
      @toggle-pause="togglePause"
      @toggle-compact="state.setDensity(state.density === 'compact' ? 'expanded' : 'compact')"
      @toggle-stack-direction="state.dispatchPasteStack({ type: 'set-direction', direction: state.pasteStack.direction === 'forward' ? 'reverse' : 'forward' })"
      @clear-stack="state.dispatchPasteStack({ type: 'clear' })"
      @open-sync-settings="openSyncSettings"
    />
    <SyncSettingsPanel
      v-if="syncSettingsOpen"
      :settings="syncSettings"
      :saving="syncSettingsSaving"
      @close="syncSettingsOpen = false"
      @save="saveSyncSettings"
      @retry="status = '同步重试将在运行时接入后执行'"
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
