<script setup lang="ts">
import { ref } from "vue";

import type { Pinboard } from "@pasteboard-pro/core";

defineProps<{ pinboards: readonly Pinboard[]; activeId: string | undefined }>();
const emit = defineEmits<{
  select: [id: string | undefined];
  create: [name: string];
  rename: [id: string, name: string];
  assign: [pinboardId: string | undefined, itemId: string];
}>();

const creating = ref(false);
const editingId = ref<string>();
const draft = ref("");

function beginCreate(): void {
  editingId.value = undefined;
  draft.value = "";
  creating.value = true;
}

function beginRename(pinboard: Pinboard): void {
  creating.value = false;
  editingId.value = pinboard.id;
  draft.value = pinboard.name;
}

function cancelEdit(): void {
  creating.value = false;
  editingId.value = undefined;
  draft.value = "";
}

function commitCreate(): void {
  const name = draft.value.trim();
  if (name.length > 0) emit("create", name);
  cancelEdit();
}

function commitRename(id: string): void {
  const name = draft.value.trim();
  if (name.length > 0) emit("rename", id, name);
  cancelEdit();
}

function dropItem(event: DragEvent, pinboardId: string | undefined): void {
  const itemId = event.dataTransfer?.getData("application/x-pasteboard-pro-item");
  if (itemId) emit("assign", pinboardId, itemId);
}
</script>

<template>
  <nav class="pinboards" aria-label="Pinboards">
    <button
      type="button"
      :class="{ active: activeId === undefined }"
      @dragover.prevent
      @drop.prevent="dropItem($event, undefined)"
      @click="emit('select', undefined)"
    >
      全部
    </button>
    <div
      v-for="pinboard in pinboards"
      :key="pinboard.id"
      class="pinboard-chip"
      :class="{ 'pinboard-chip--active': activeId === pinboard.id }"
      @dragover.prevent
      @drop.prevent="dropItem($event, pinboard.id)"
    >
      <button
        v-if="editingId !== pinboard.id"
        type="button"
        @click="emit('select', pinboard.id)"
        @dblclick.stop="beginRename(pinboard)"
      >
        <span class="dot" :style="{ background: pinboard.color }"></span>
        <span>{{ pinboard.name }}</span>
      </button>
      <input
        v-else
        v-model="draft"
        class="inline-name"
        aria-label="重命名 Pinboard"
        autofocus
        @click.stop
        @keydown.enter.prevent="commitRename(pinboard.id)"
        @keydown.escape.prevent="cancelEdit"
        @blur="commitRename(pinboard.id)"
      />
    </div>
    <input
      v-if="creating"
      v-model="draft"
      class="inline-name inline-name--new"
      aria-label="新建 Pinboard"
      placeholder="Pinboard 名称"
      autofocus
      @keydown.enter.prevent="commitCreate"
      @keydown.escape.prevent="cancelEdit"
      @blur="commitCreate"
    />
    <button v-else type="button" class="add-button" aria-label="新建 Pinboard" @click="beginCreate">+</button>
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

.pinboard-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 26px;
  border-radius: 9px;
}

.pinboard-chip > button {
  min-height: 26px;
}

.pinboard-chip--active {
  background: color-mix(in srgb, var(--pb-violet) 13%, transparent);
}

.pinboard-chip--active > button {
  color: var(--pb-violet);
}

button:focus-visible {
  outline: 2px solid var(--pb-violet);
}

.inline-name {
  width: 92px;
  min-height: 22px;
  padding: 0 5px;
  border: 1px solid var(--pb-violet);
  border-radius: 7px;
  outline: 0;
  background: var(--pb-glass-strong);
  color: var(--pb-ink);
  font-size: 11px;
}

.inline-name--new {
  flex: 0 0 116px;
}

.add-button {
  width: 26px;
  padding: 0;
  justify-content: center;
  border: 1px dashed var(--pb-line);
  font-size: 16px;
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
