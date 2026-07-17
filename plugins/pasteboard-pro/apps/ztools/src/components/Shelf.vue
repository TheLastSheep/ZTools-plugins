<script setup lang="ts">
import { computed } from "vue";

import type { PasteItem, PasteStackDirection, Pinboard } from "@pasteboard-pro/core";
import type { DockEdge } from "@pasteboard-pro/design-tokens";

import { visualState, type ShelfDensity } from "../state";
import PasteStack from "./PasteStack.vue";
import PinboardStrip from "./PinboardStrip.vue";
import Preview from "./Preview.vue";
import Timeline from "./Timeline.vue";
import Toolbar from "./Toolbar.vue";

const props = defineProps<{
  items: readonly PasteItem[];
  pinboards: readonly Pinboard[];
  selectedIds: readonly string[];
  query: string;
  paused: boolean;
  edge: DockEdge;
  density: ShelfDensity;
  activePinboardId: string | undefined;
  previewItem: PasteItem | undefined;
  pasteStackCount: number;
  pasteStackDirection: PasteStackDirection;
}>();

const emit = defineEmits<{
  "update:query": [value: string];
  select: [itemId: string, extend: boolean, toggle: boolean];
  paste: [itemId: string, plainText?: boolean];
  preview: [itemId: string];
  ocr: [itemId: string];
  rotate: [itemId: string, quarterTurns: -1 | 1];
  quickLook: [itemId: string];
  closePreview: [];
  selectPinboard: [id: string | undefined];
  createPinboard: [name: string];
  renamePinboard: [id: string, name: string];
  updatePinboardColor: [id: string, color: string];
  movePinboard: [id: string, direction: -1 | 1];
  deletePinboard: [id: string];
  assignPinboard: [pinboardId: string | undefined, itemId: string];
  togglePause: [];
  toggleCompact: [];
  toggleStackDirection: [];
  clearStack: [];
  openSyncSettings: [];
  addStack: [];
  openPrivacySettings: [];
  createText: [];
  editItem: [itemId: string];
  renameItem: [itemId: string];
}>();

const style = computed(() => visualState(props.edge, props.density));

function forwardSelect(itemId: string, extend: boolean, toggle: boolean): void {
  emit("select", itemId, extend, toggle);
}

function forwardRenamePinboard(id: string, name: string): void {
  emit("renamePinboard", id, name);
}

function forwardAssignPinboard(
  pinboardId: string | undefined,
  itemId: string,
): void {
  emit("assignPinboard", pinboardId, itemId);
}

function forwardPreviewPaste(itemId: string, plainText: boolean): void {
  emit("paste", itemId, plainText);
}
</script>

<template>
  <section
    class="shelf glass-surface"
    :class="style.dockClass"
    :style="{ '--pb-card-width': `${style.cardWidth}px`, '--pb-dock-ms': `${style.transitionMs}ms` }"
    aria-label="PasteboardPro"
  >
    <Toolbar
      :query="query"
      :paused="paused"
      :compact="density === 'compact'"
      @update:query="emit('update:query', $event)"
      @toggle-pause="emit('togglePause')"
      @toggle-compact="emit('toggleCompact')"
      @open-sync-settings="emit('openSyncSettings')"
      @add-stack="emit('addStack')"
      @open-privacy-settings="emit('openPrivacySettings')"
      @create-text="emit('createText')"
    />
    <PinboardStrip
      :pinboards="pinboards"
      :active-id="activePinboardId"
      @select="emit('selectPinboard', $event)"
      @create="emit('createPinboard', $event)"
      @rename="forwardRenamePinboard"
      @update-color="emit('updatePinboardColor', $event.id, $event.color)"
      @move="emit('movePinboard', $event.id, $event.direction)"
      @delete="emit('deletePinboard', $event)"
      @assign="forwardAssignPinboard"
    />
    <Timeline
      :items="items"
      :selected-ids="selectedIds"
      @select="forwardSelect"
      @paste="emit('paste', $event)"
      @preview="emit('preview', $event)"
    />
    <Preview
      v-if="previewItem"
      :item="previewItem"
      @close="emit('closePreview')"
      @paste="forwardPreviewPaste"
      @ocr="emit('ocr', $event)"
      @rotate="emit('rotate', $event.itemId, $event.quarterTurns)"
      @quick-look="emit('quickLook', $event)"
      @edit="emit('editItem', $event)"
      @rename="emit('renameItem', $event)"
    />
    <PasteStack
      :count="pasteStackCount"
      :direction="pasteStackDirection"
      @toggle-direction="emit('toggleStackDirection')"
      @clear="emit('clearStack')"
    />
  </section>
</template>

<style scoped>
.shelf {
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 244px;
  overflow: hidden;
  border-radius: var(--pb-radius);
  transition: border-radius var(--pb-dock-ms) ease, transform var(--pb-dock-ms) ease;
}

.shelf--bottom {
  border-bottom-right-radius: 0;
  border-bottom-left-radius: 0;
}

.shelf--left {
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
.shelf--right {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

@media (prefers-reduced-motion: reduce) {
  .shelf {
    transition: none;
  }
}
</style>
