'use strict';
const api = globalThis.ztools || {}; let selectedRoot = null; const GRANT_TTL_MS = 5 * 60 * 1000;
function selectedPath(result) { if (typeof result === 'string') return result; if (Array.isArray(result)) return result[0]; return result && result.filePaths && result.filePaths[0]; }
async function loadGuard() { return import('../core/guard.mjs'); }
const bridge = {
  choosePluginDirectory: async () => { if (typeof api.showOpenDialog !== 'function') throw new Error('This ZTools host does not provide a directory dialog.'); selectedRoot = null; const result = selectedPath(await api.showOpenDialog({ title: 'Choose plugin directory', properties: ['openDirectory'] })); if (!result) throw new Error('Selection cancelled.'); selectedRoot = { path:String(result), expires:Date.now()+GRANT_TTL_MS }; return true; },
  scan: async () => { if (!selectedRoot || selectedRoot.expires<Date.now()) { selectedRoot=null; throw new Error('Choose a plugin directory first or renew the expired grant.'); } const report = await (await loadGuard()).scanPlugin(selectedRoot.path); const { root, ...safe } = report; return safe; },
  copyText: typeof api.copyText === 'function' ? (text) => api.copyText(String(text)) : undefined
};
globalThis.pluginGuard = Object.freeze(bridge);
if (typeof api.onPluginOut === 'function') api.onPluginOut(() => { selectedRoot = null; });
