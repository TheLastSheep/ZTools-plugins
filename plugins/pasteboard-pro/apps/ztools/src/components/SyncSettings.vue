<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import type { SaveSyncConfigurationInput } from "../../preload/sync-config";
import type { SyncSettings } from "../../preload/sync-store";
import { syncStatusPresentation } from "../sync-view";

const props = defineProps<{ settings: SyncSettings; saving: boolean }>();
const emit = defineEmits<{
  close: [];
  save: [input: SaveSyncConfigurationInput];
  retry: [];
}>();

const form = reactive({
  enabled: props.settings.enabled,
  baseUrl: props.settings.baseUrl,
  username: props.settings.username,
  webdavPassword: "",
  syncPassword: "",
  syncFileContents: props.settings.syncFileContents,
});
const presentation = computed(() => syncStatusPresentation(props.settings.status));

watch(
  () => props.settings,
  (settings) => {
    form.enabled = settings.enabled;
    form.baseUrl = settings.baseUrl;
    form.username = settings.username;
    form.webdavPassword = "";
    form.syncPassword = "";
    form.syncFileContents = settings.syncFileContents;
  },
);

function save(): void {
  emit("save", {
    enabled: form.enabled,
    baseUrl: form.baseUrl,
    username: form.username,
    ...(form.webdavPassword.length === 0 ? {} : { webdavPassword: form.webdavPassword }),
    ...(form.syncPassword.length === 0 ? {} : { syncPassword: form.syncPassword }),
    syncFileContents: form.syncFileContents,
  });
}
</script>

<template>
  <div class="sync-backdrop" @click.self="emit('close')">
    <section class="sync-panel glass-surface" aria-labelledby="sync-title">
      <header class="sync-panel__header">
        <div>
          <p class="sync-panel__eyebrow">Encrypted WebDAV</p>
          <h2 id="sync-title">同步剪贴板</h2>
        </div>
        <button class="sync-panel__close" type="button" aria-label="关闭同步设置" @click="emit('close')">×</button>
      </header>

      <div class="sync-pulse" :class="`sync-pulse--${presentation.tone}`">
        <span class="sync-pulse__orb" aria-hidden="true"></span>
        <div>
          <strong>{{ presentation.label }}</strong>
          <span>{{ presentation.detail }}</span>
        </div>
        <button v-if="presentation.action === 'retry'" type="button" @click="emit('retry')">重试</button>
      </div>

      <form class="sync-form" @submit.prevent="save">
        <label class="sync-toggle">
          <span><strong>启用加密同步</strong><small>正文、OCR、Pinboards、图片和 PDF 默认同步</small></span>
          <input v-model="form.enabled" type="checkbox" />
        </label>

        <div class="sync-grid" :aria-disabled="!form.enabled">
          <label class="sync-field sync-field--wide">
            <span>WebDAV 地址</span>
            <input v-model="form.baseUrl" :disabled="!form.enabled" type="url" placeholder="https://dav.example.com/PasteboardPro/v1/" autocomplete="url" />
          </label>
          <label class="sync-field">
            <span>用户名</span>
            <input v-model="form.username" :disabled="!form.enabled" autocomplete="username" />
          </label>
          <label class="sync-field">
            <span>WebDAV 密码</span>
            <input v-model="form.webdavPassword" :disabled="!form.enabled" type="password" placeholder="未修改" autocomplete="current-password" />
          </label>
          <label class="sync-field sync-field--wide">
            <span>剪贴板同步密码</span>
            <input v-model="form.syncPassword" :disabled="!form.enabled" type="password" placeholder="用于端到端加密；丢失后无法恢复" autocomplete="new-password" />
          </label>
        </div>

        <label class="sync-toggle sync-toggle--quiet">
          <span><strong>同步任意文件内容</strong><small>默认只同步文件元数据；单项最大 100 MB</small></span>
          <input v-model="form.syncFileContents" :disabled="!form.enabled" type="checkbox" />
        </label>

        <p class="sync-panel__privacy">密码和派生密钥只保存在 macOS 钥匙串；插件数据库不保存明文秘密。</p>
        <footer class="sync-panel__footer">
          <button type="button" class="sync-button sync-button--quiet" @click="emit('close')">取消</button>
          <button type="submit" class="sync-button sync-button--primary" :disabled="saving">{{ saving ? "正在保存…" : "保存设置" }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.sync-backdrop { position: absolute; inset: 0; z-index: 20; display: grid; padding: 12px; background: color-mix(in srgb, #171521 28%, transparent); place-items: center; backdrop-filter: blur(10px); }
.sync-panel { width: min(620px, 100%); max-height: calc(100% - 8px); overflow: auto; border: 1px solid var(--pb-line); border-radius: 20px; background: color-mix(in srgb, var(--pb-glass-strong) 92%, transparent); box-shadow: 0 28px 80px rgb(25 20 43 / 32%); }
.sync-panel__header { display: flex; align-items: flex-start; justify-content: space-between; padding: 20px 22px 14px; }
.sync-panel__eyebrow { margin: 0 0 4px; color: var(--pb-violet); font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
h2 { margin: 0; color: var(--pb-ink); font-size: 20px; letter-spacing: -.025em; }
.sync-panel__close { width: 30px; height: 30px; border: 0; border-radius: 50%; background: color-mix(in srgb, var(--pb-line) 60%, transparent); color: var(--pb-muted); cursor: pointer; font-size: 20px; }
.sync-pulse { display: grid; grid-template-columns: auto 1fr auto; gap: 11px; align-items: center; margin: 0 22px 16px; padding: 12px 14px; border: 1px solid var(--pb-line); border-radius: 14px; background: color-mix(in srgb, var(--pb-glass-strong) 56%, transparent); }
.sync-pulse__orb { width: 10px; height: 10px; border-radius: 50%; background: var(--pb-muted); box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 12%, transparent); }
.sync-pulse--success .sync-pulse__orb { background: #36b37e; }.sync-pulse--warning .sync-pulse__orb { background: #e99a35; }.sync-pulse--error .sync-pulse__orb { background: #e45568; }.sync-pulse--progress .sync-pulse__orb { background: var(--pb-violet); animation: sync-breathe 1.3s ease-in-out infinite; }
.sync-pulse div { display: grid; gap: 2px; }.sync-pulse strong { font-size: 12px; }.sync-pulse span { color: var(--pb-muted); font-size: 11px; }.sync-pulse button { border: 0; background: transparent; color: var(--pb-violet); cursor: pointer; font-weight: 700; }
.sync-form { padding: 0 22px 20px; }.sync-toggle { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 0; border-top: 1px solid var(--pb-line); }.sync-toggle span { display: grid; gap: 3px; }.sync-toggle strong { font-size: 12px; }.sync-toggle small { color: var(--pb-muted); font-size: 10px; }.sync-toggle input { width: 32px; accent-color: var(--pb-violet); }.sync-toggle--quiet { margin-top: 4px; }
.sync-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; padding: 12px 0; }.sync-field { display: grid; gap: 6px; }.sync-field--wide { grid-column: 1 / -1; }.sync-field span { color: var(--pb-muted); font-size: 10px; font-weight: 700; }.sync-field input { width: 100%; height: 36px; padding: 0 11px; border: 1px solid var(--pb-line); border-radius: 10px; outline: none; background: color-mix(in srgb, var(--pb-glass-strong) 58%, transparent); color: var(--pb-ink); }.sync-field input:focus { border-color: var(--pb-violet); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pb-violet) 14%, transparent); }.sync-field input:disabled { opacity: .45; }
.sync-panel__privacy { margin: 8px 0 16px; color: var(--pb-muted); font-size: 10px; line-height: 1.5; }.sync-panel__footer { display: flex; gap: 8px; justify-content: flex-end; }.sync-button { min-height: 36px; padding: 0 14px; border: 1px solid var(--pb-line); border-radius: 11px; cursor: pointer; font-weight: 700; }.sync-button--quiet { background: transparent; color: var(--pb-muted); }.sync-button--primary { border-color: transparent; background: var(--pb-violet); color: white; }.sync-button:disabled { cursor: wait; opacity: .55; }
@keyframes sync-breathe { 50% { transform: scale(1.25); box-shadow: 0 0 0 8px color-mix(in srgb, var(--pb-violet) 4%, transparent); } }
@media (max-width: 620px) { .sync-grid { grid-template-columns: 1fr; }.sync-field--wide { grid-column: auto; } }
@media (prefers-reduced-motion: reduce) { .sync-pulse__orb { animation: none; } }
</style>
