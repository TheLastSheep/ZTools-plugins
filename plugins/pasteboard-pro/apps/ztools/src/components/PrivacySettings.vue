<script setup lang="ts">
import { reactive, watch } from "vue";

import type { PrivacySettings } from "../../preload/privacy";
import {
  lines,
  parseContentRules,
  parseLines,
  serializeContentRules,
} from "../privacy-view";

const props = defineProps<{ settings: PrivacySettings; saving: boolean }>();
const emit = defineEmits<{
  close: [];
  save: [settings: PrivacySettings];
}>();

const form = reactive({
  ignoredBundleIds: lines(props.settings.rules.ignoredBundleIds),
  contentRules: serializeContentRules(props.settings.rules.contentRules),
  blockLikelySecrets: props.settings.rules.blockLikelySecrets,
  retentionDays: props.settings.retention.days,
  maxBlobGiB: props.settings.retention.maxBlobBytes / 1_073_741_824,
  screenShareProtection: props.settings.screenShareProtection,
});

watch(
  () => props.settings,
  (settings) => {
    form.ignoredBundleIds = lines(settings.rules.ignoredBundleIds);
    form.contentRules = serializeContentRules(settings.rules.contentRules);
    form.blockLikelySecrets = settings.rules.blockLikelySecrets;
    form.retentionDays = settings.retention.days;
    form.maxBlobGiB = settings.retention.maxBlobBytes / 1_073_741_824;
    form.screenShareProtection = settings.screenShareProtection;
  },
);

function save(): void {
  emit("save", {
    pause: props.settings.pause,
    rules: {
      ignoredBundleIds: parseLines(form.ignoredBundleIds),
      blockLikelySecrets: form.blockLikelySecrets,
      contentRules: parseContentRules(form.contentRules),
    },
    retention: {
      days: Math.round(form.retentionDays),
      maxBlobBytes: Math.round(form.maxBlobGiB * 1_073_741_824),
    },
    screenShareProtection: form.screenShareProtection,
  });
}
</script>

<template>
  <div class="settings-backdrop" @click.self="emit('close')">
    <section class="settings-panel glass-surface" aria-labelledby="privacy-title">
      <header>
        <div><p>Local Privacy</p><h2 id="privacy-title">隐私与历史保留</h2></div>
        <button type="button" aria-label="关闭隐私设置" @click="emit('close')">×</button>
      </header>
      <form @submit.prevent="save">
        <label class="toggle">
          <span><strong>自动排除高置信度秘密</strong><small>令牌、私钥和已知凭据格式在写入历史前过滤</small></span>
          <input v-model="form.blockLikelySecrets" type="checkbox" />
        </label>
        <label class="toggle">
          <span><strong>屏幕共享时隐藏浮窗</strong><small>使用 Electron content protection，保存后立即应用</small></span>
          <input v-model="form.screenShareProtection" type="checkbox" />
        </label>
        <div class="grid">
          <label><span>普通历史保留天数</span><input v-model.number="form.retentionDays" type="number" min="1" max="3650" /></label>
          <label><span>附件预算（GiB）</span><input v-model.number="form.maxBlobGiB" type="number" min="0.0625" max="100" step="0.25" /></label>
        </div>
        <label class="field"><span>排除应用 Bundle ID（每行一个）</span><textarea v-model="form.ignoredBundleIds" rows="4" spellcheck="false" /></label>
        <label class="field"><span>内容规则（literal: / wildcard: / regex:）</span><textarea v-model="form.contentRules" rows="5" spellcheck="false" placeholder="literal:PRIVATE NOTE&#10;wildcard:otp-*&#10;regex:^internal-[0-9]+$/i" /></label>
        <p class="hint">隐私规则在元数据和附件落盘前执行；Pinboard 与固定内容不会被普通保留策略静默删除。</p>
        <footer>
          <button type="button" class="quiet" @click="emit('close')">取消</button>
          <button type="submit" class="primary" :disabled="saving">{{ saving ? "正在保存…" : "保存设置" }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<style scoped>
.settings-backdrop { position:absolute; inset:0; z-index:21; display:grid; padding:12px; place-items:center; background:color-mix(in srgb,#171521 28%,transparent); backdrop-filter:blur(10px); }
.settings-panel { width:min(650px,100%); max-height:calc(100% - 8px); overflow:auto; border:1px solid var(--pb-line); border-radius:20px; background:color-mix(in srgb,var(--pb-glass-strong) 94%,transparent); box-shadow:0 28px 80px rgb(25 20 43 / 32%); }
header { display:flex; align-items:flex-start; justify-content:space-between; padding:20px 22px 14px; } header p { margin:0 0 4px; color:var(--pb-violet); font-size:10px; font-weight:800; letter-spacing:.12em; text-transform:uppercase; } h2 { margin:0; font-size:20px; } header button { width:30px; height:30px; border:0; border-radius:50%; background:color-mix(in srgb,var(--pb-line) 60%,transparent); color:var(--pb-muted); cursor:pointer; font-size:20px; }
form { padding:0 22px 20px; }.toggle { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:13px 0; border-top:1px solid var(--pb-line); }.toggle span { display:grid; gap:3px; }.toggle strong { font-size:12px; }.toggle small,.hint { color:var(--pb-muted); font-size:10px; line-height:1.5; }.toggle input { width:32px; accent-color:var(--pb-violet); }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:11px; padding:12px 0; }.grid label,.field { display:grid; gap:6px; }.grid span,.field span { color:var(--pb-muted); font-size:10px; font-weight:700; } input[type="number"],textarea { width:100%; padding:9px 11px; border:1px solid var(--pb-line); border-radius:10px; outline:none; background:color-mix(in srgb,var(--pb-glass-strong) 58%,transparent); color:var(--pb-ink); } textarea { resize:vertical; font:11px/1.45 "SFMono-Regular",Consolas,monospace; }.field { margin-top:11px; }
footer { display:flex; gap:8px; justify-content:flex-end; margin-top:16px; } footer button { min-height:36px; padding:0 14px; border:1px solid var(--pb-line); border-radius:11px; cursor:pointer; font-weight:700; }.quiet { background:transparent; color:var(--pb-muted); }.primary { border-color:transparent; background:var(--pb-violet); color:white; }.primary:disabled { cursor:wait; opacity:.55; }
@media (max-width:620px) { .grid { grid-template-columns:1fr; } }
</style>
