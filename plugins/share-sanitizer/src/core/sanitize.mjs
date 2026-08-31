const MAX_INPUT = 1024 * 1024;
const MAX_FINDINGS = 500;
const RULES = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
  phone_cn: /(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g,
  ipv4: /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?![\w.])/g,
  win_path: /(?<![\w])(?:[A-Za-z]:\\|\\\\[^\\/\s]+\\[^\\/\s]+\\)[^\0<>:"|?*\s\r\n]*/g,
  posix_path: /(?<![\w/])\/(?:[^\0\r\n/ ]+\/)*[^\0\r\n/ ]+/g,
  bearer: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}\b/gi,
  api_key: /\b(?:api[_-]?key|token|secret)\s*[:=]\s*['\"]?[A-Za-z0-9_\-.]{12,}/gi,
  jwt: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  id_cn: /(?<!\d)\d{17}[\dXx](?!\d)/g
};
const DEFAULT_ENABLED = Object.freeze(Object.fromEntries(Object.keys(RULES).map((key) => [key, true])));

function chineseIdValid(value) {
  if (!/^\d{17}[\dXx]$/.test(value)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
  const check = '10X98765432';
  let sum = 0;
  for (let i = 0; i < 17; i += 1) sum += Number(value[i]) * weights[i];
  return check[sum % 11].toLowerCase() === value[17].toLowerCase();
}

function runRule(type, regex, text, whitelist) {
  regex.lastIndex = 0;
  const findings = [];
  let match;
  while ((match = regex.exec(text)) && findings.length < MAX_FINDINGS) {
    const value = match[0];
    if (type === 'id_cn' && !chineseIdValid(value)) continue;
    if (whitelist.has(value.toLowerCase())) continue;
    findings.push({ start: match.index, end: match.index + value.length, value, type, confidence: type === 'id_cn' ? 0.99 : 0.92 });
    if (match.index === regex.lastIndex) regex.lastIndex += 1;
  }
  return findings;
}

export function detectSensitive(text, options = {}) {
  const source = String(text ?? '');
  if (new TextEncoder().encode(source).byteLength > (options.maxInput || MAX_INPUT)) throw new RangeError('Text exceeds the 1 MiB safety limit.');
  const enabled = { ...DEFAULT_ENABLED, ...(options.enabled || {}) };
  const list = options.whitelist || []; if (!Array.isArray(list) || list.length > 200) throw new RangeError('Whitelist exceeds the 200-value safety limit.');
  const whitelist = new Set(list.map((item) => String(item).toLowerCase()));
  if (Object.keys(enabled).filter((key)=>enabled[key] && Object.prototype.hasOwnProperty.call(RULES,key)).length > Object.keys(RULES).length) throw new RangeError('Too many rules enabled.');
  let findings = [];
  for (const [type, regex] of Object.entries(RULES)) if (enabled[type]) findings = findings.concat(runRule(type, regex, source, whitelist));
  findings.sort((a, b) => a.start - b.start || b.end - a.end || a.type.localeCompare(b.type));
  const nonOverlapping = [];
  for (const item of findings) {
    const prior = nonOverlapping[nonOverlapping.length - 1];
    if (!prior || item.start >= prior.end) nonOverlapping.push(item);
    if (nonOverlapping.length >= (options.maxFindings || MAX_FINDINGS)) break;
  }
  return nonOverlapping;
}

export function redactText(text, options = {}) {
  const source = String(text ?? '');
  const findings = detectSensitive(source, options);
  const replacement = options.replacement || '[REDACTED]';
  let cursor = 0;
  let output = '';
  for (const finding of findings) {
    output += source.slice(cursor, finding.start) + replacement;
    cursor = finding.end;
  }
  return { text: output + source.slice(cursor), findings };
}

export function imageExportDecision(maskCount, metadataConfirmed = false) {
  if (Number(maskCount) > 0) return { ok: true, mode: 'redacted' };
  return metadataConfirmed ? { ok: true, mode: 'metadata-only' } : { ok: false, mode: 'confirm-metadata-only' };
}

export const defaults = Object.freeze({ MAX_INPUT, MAX_FINDINGS, DEFAULT_ENABLED });
