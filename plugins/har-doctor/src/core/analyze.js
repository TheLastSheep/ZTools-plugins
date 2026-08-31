const SENSITIVE = /authorization|cookie|set-cookie|token|access_token|session|secret|api[-_]?key|password|signature|sign/i;
const SECRET_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\b(?:api[_-]?key|token|secret|password|signature)\s*[:=]\s*['"]?[^\s,'";]{6,}/gi;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 5000;

export function fileContract(platform, filename) {
  const base = String(filename || '').split(platform === 'win32' ? /[\\/]/ : /\//).pop();
  return { platform, accepted: /\.har$/i.test(base), base };
}

export function parseHar(text) {
  if (utf8Length(String(text)) > MAX_BYTES) throw new Error('HAR exceeds 20 MiB limit');
  let value; try { value = JSON.parse(text); } catch { throw new Error('Invalid HAR JSON'); }
  if (!value || !value.log || !Array.isArray(value.log.entries)) throw new Error('HAR requires log.entries');
  if (value.log.entries.length > MAX_ENTRIES) throw new Error('HAR exceeds 5,000 entry limit');
  return value;
}

function utf8Length(text) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : Buffer.byteLength(text, 'utf8'); }

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]');
  if (!value || typeof value !== 'object') return value;
  if (typeof value.name === 'string' && SENSITIVE.test(value.name)) return { ...value, value: '[redacted]' };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE.test(key) ? '[redacted]' : redact(item)]));
}

function headers(items) { return Object.fromEntries((items || []).map(({ name, value }) => [String(name).toLowerCase(), String(value || '')])); }
function host(url) { try { return new URL(url).host; } catch { return '(invalid url)'; } }
export function redactUrl(raw) { try { const url = new URL(raw); url.username='';url.password='';url.hash='';for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '[redacted]'); return url.toString(); } catch { return String(raw).replace(/([?&][^=&#\s]+)=?[^&#\s]*/g,'$1=[redacted]').replace(/#[^\s]*/,''); } }
function mime(entry) { return String(entry.response?.content?.mimeType || '').split(';')[0] || 'unknown'; }
function sumTiming(timing) { return Object.values(timing || {}).reduce((n, v) => n + (Number(v) > 0 ? Number(v) : 0), 0); }

export function analyze(har) {
  const entries = har.log.entries;
  const result = { entries: entries.length, totalMs: 0, transferredBytes: 0, domains: Object.create(null), types: Object.create(null), slow: [], errors: [], redirects: [], cache: [], cors: [], security: [], duplicateBytes: 0, invalidUrls: 0 };
  const seen = new Map();
  for (const entry of entries) {
    const request = entry.request || {}, response = entry.response || {};
    const url = redactUrl(request.url || ''); const duration = Number(entry.time) > 0 ? Number(entry.time) : sumTiming(entry.timings);
    const declared=Number(response.bodySize);const size = declared>=0?declared:Math.max(0, Number(response.content?.size) || 0); const status = Number(response.status) || 0;
    const domain = host(url); if (domain === '(invalid url)') result.invalidUrls++;
    result.totalMs += duration; result.transferredBytes += size;
    result.domains[domain] = (result.domains[domain] || 0) + 1; const kind = mime(entry); result.types[kind] = (result.types[kind] || 0) + 1;
    const timing={};for(const key of ['blocked','dns','connect','send','wait','receive','ssl'])if(Number.isFinite(Number(entry.timings?.[key])))timing[key]=Number(entry.timings[key]);const item = { url, method: request.method || 'GET', status, duration, size, timing };
    if (duration >= 1000) result.slow.push(item);
    if (status >= 400) result.errors.push(item);
    if (status >= 300 && status < 400) result.redirects.push(item);
    const h = headers(response.headers); const q = headers(request.headers);
    if (h['cache-control'] || h.etag || h['last-modified']) result.cache.push({ url, cacheControl: Boolean(h['cache-control']), noStore: /(?:^|,)\s*no-store\b/i.test(h['cache-control'] || ''), noCache: /(?:^|,)\s*no-cache\b/i.test(h['cache-control'] || ''), etag: Boolean(h.etag), lastModified: Boolean(h['last-modified']) });
    if (q.origin && !h['access-control-allow-origin']) result.cors.push({ url, reason: 'Origin request lacks ACAO response header' });
    const missing = ['strict-transport-security', 'content-security-policy', 'x-content-type-options'].filter((name) => !h[name]);
    if (url.startsWith('https:') && missing.length) result.security.push({ url, missing });
    const prior = seen.get(url); if (prior) result.duplicateBytes += Math.min(size, prior); else seen.set(url, size);
  }
  result.slow.sort((a, b) => b.duration - a.duration); return result;
}

export function diffReports(before, after) {
  const numeric = (v) => Array.isArray(v) ? v.length : Number(v || 0);
  const compare = (key) => numeric(after[key]) - numeric(before[key]);
  return { entries: compare('entries'), totalMs: compare('totalMs'), transferredBytes: compare('transferredBytes'), errors: compare('errors'), slow: compare('slow'), duplicateBytes: compare('duplicateBytes') };
}

export function toMarkdown(report, diff) {
  const lines = [`# HAR Doctor report`, '', `- Entries: ${report.entries}`, `- Total waterfall time: ${report.totalMs} ms`, `- Transfer: ${report.transferredBytes} bytes`, `- Errors: ${report.errors.length}`, `- Slow requests: ${report.slow.length}`, `- Duplicate transfer estimate: ${report.duplicateBytes} bytes`];
  if (diff) lines.push('', '## Environment delta', ...Object.entries(diff).map(([k, v]) => `- ${k}: ${v >= 0 ? '+' : ''}${v}`));
  return lines.join('\n');
}
