const { WebhookServer, hmac, curlFor } = require('../core/server.cjs');
let owner = null;
let registered = false;
const SENSITIVE = /authorization|cookie|token|secret|api[-_]?key|password|signature|credential|(^|[-_])sig(nature)?($|[-_])/i;

function safeOptions(input = {}) {
  const port = Number(input.port), options = {};
  if (Number.isInteger(port) && port >= 0 && port <= 65535) options.port = port;
  return options;
}
function assign(target, key, value) { Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true }); }
function redactString(value) {
  return value.slice(0, 4096)
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted]')
    .replace(/\b(token|secret|password|api[_ -]?key|authorization|signature|credential)\s*([=:])\s*[^\s&#,;]+/gi, '$1$2[redacted]')
    .replace(/([?&](?:token|secret|password|api[_-]?key|authorization|signature|credential)=)[^&#\s]*/gi, '$1[redacted]');
}
function redact(value) {
  const root = { value: null }, queue = [{ source: value, target: root, key: 'value', depth: 0, sensitive: false }];
  let nodes = 0;
  while (queue.length) {
    const item = queue.pop();
    const inheritedSensitive = item.sensitive;
    if (inheritedSensitive) { assign(item.target, item.key, '[redacted]'); continue; }
    if (item.source === null || typeof item.source !== 'object') { assign(item.target, item.key, typeof item.source === 'string' ? redactString(item.source) : item.source); continue; }
    if (++nodes > 2000 || item.depth > 48) { assign(item.target, item.key, '[truncated]'); continue; }
    const namedSecret = typeof item.source.name === 'string' && SENSITIVE.test(item.source.name);
    const copy = Array.isArray(item.source) ? [] : Object.create(null);
    assign(item.target, item.key, copy);
    for (const [key, next] of Object.entries(item.source)) queue.push({ source: next, target: copy, key, depth: item.depth + 1, sensitive: namedSecret || SENSITIVE.test(key) });
  }
  return root.value;
}
function safeEvents() { return redact((owner?.events || []).slice(0, 200)); }
function register(ztools) {
  if (registered) return;
  registered = true;
  const stop = async () => { const current = owner; owner = null; current?.clear(); await current?.stop(); };
  if (typeof ztools?.onPluginOut === 'function') ztools.onPluginOut(stop);
  else if (typeof ztools?.onPluginExit === 'function') ztools.onPluginExit(stop);
}
function bridge(ztools) {
  register(ztools);
  return Object.freeze({
    start: async (options) => { const next = safeOptions(options); if (!owner) owner = new WebhookServer(next); else if (Object.hasOwn(next, 'port') && owner.options.port !== next.port) await owner.restart(next); return owner.start(); },
    stop: async () => { const current = owner; owner = null; await current?.stop(); },
    events: safeEvents,
    hmac: (body, secret, algorithm) => hmac(body, secret, algorithm),
    curl: (url) => curlFor(url, process.platform),
    copyText: (text) => ztools?.copyText?.(String(text))
  });
}
if (typeof window !== 'undefined') window.webhookLab = bridge(window.ztools);
module.exports = { bridge, __testOwner: () => owner, __testSetOwner: (next) => { owner = next; } };
