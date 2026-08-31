const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const MAX = 10 * 1024 * 1024, TTL = 300000, DEPTH = 60, NODES = 40000;
let grants = [];

function close(record) { try { fs.closeSync(record.fd); } catch {} }
function clear() { for (const record of grants) close(record); grants = []; }
function audit(root) {
  const queue = [[root, 0]], seen = new Set(); let nodes = 0;
  while (queue.length) {
    const [value, depth] = queue.pop();
    if (depth > DEPTH || ++nodes > NODES) throw Error('Contract exceeds safe structure limits');
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const [key, next] of Object.entries(value)) {
      queue.push([key, depth + 1]);
      if (key === '$ref' && typeof next === 'string' && !next.startsWith('#/')) throw Error('Remote $ref is not allowed');
      queue.push([next, depth + 1]);
    }
  }
}
function record(file) {
  const real = fs.realpathSync(file), link = fs.lstatSync(file);
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(fd);
    if (link.isSymbolicLink() || !stat.isFile() || stat.size > MAX || !/\.(json|ya?ml)$/i.test(real)) throw Error('Rejected contract file');
    return { fd, real, size: stat.size, mtime: stat.mtimeMs, dev: stat.dev, ino: stat.ino, until: Date.now() + TTL };
  } catch (error) { close({ fd }); throw error; }
}
function grant(files) {
  clear();
  if (!Array.isArray(files) || files.length < 1 || files.length > 2) throw Error('Choose one or two contract files');
  const selected = [];
  try { for (const file of files) selected.push(record(file)); grants = selected; return grants.map((item) => path.basename(item.real)); }
  catch (error) { for (const item of selected) close(item); throw error; }
}
function auditYamlNode(node, seen = new Set()) {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (node.anchor || node.tag || node.constructor?.name === 'Alias') throw Error('YAML anchors, aliases and explicit tags are not allowed');
  if (Array.isArray(node.items)) for (const item of node.items) auditYamlNode(item, seen);
  auditYamlNode(node.key, seen);
  auditYamlNode(node.value, seen);
}
function parseYaml(text) {
  const document = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: false });
  if (document.errors.length || document.warnings.length) {
    const message = document.errors.concat(document.warnings).map((item) => item.message).join('; ');
    if (/tag|alias|anchor/i.test(message)) throw Error('YAML anchors, aliases and explicit tags are not allowed');
    throw Error(message);
  }
  auditYamlNode(document.contents);
  return document.toJS({ maxAliasCount: 0 });
}
function read(record) {
  if (Date.now() > record.until) { clear(); throw Error('Selection expired'); }
  const stat = fs.fstatSync(record.fd);
  if (stat.size !== record.size || stat.mtimeMs !== record.mtime || stat.dev !== record.dev || stat.ino !== record.ino) throw Error('Contract changed after selection');
  const buffer = Buffer.alloc(stat.size); let offset = 0;
  while (offset < buffer.length) { const count = fs.readSync(record.fd, buffer, offset, buffer.length - offset, offset); if (!count) throw Error('Incomplete read'); offset += count; }
  const document = /\.json$/i.test(record.real) ? JSON.parse(buffer.toString('utf8')) : parseYaml(buffer.toString('utf8'));
  audit(document);
  const serialized = JSON.stringify(document);
  if (Buffer.byteLength(serialized) > MAX) throw Error('Contract exceeds safe serialized size limit');
  return serialized;
}
function readGranted() {
  if (!grants.length) throw Error('Choose contract files first');
  try { return grants.map(read); }
  finally { clear(); }
}
async function choose(ztools) {
  if (typeof ztools?.showOpenDialog !== 'function') throw Error('ZTools file dialog unavailable');
  const result = await ztools.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'OpenAPI', extensions: ['json', 'yaml', 'yml'] }] });
  const files = Array.isArray(result) ? result : result?.filePaths;
  if (!files?.length) { clear(); return []; }
  return grant(files);
}
function bridge(ztools) {
  if (typeof ztools?.onPluginOut === 'function') ztools.onPluginOut(clear);
  return Object.freeze({ choose: () => choose(ztools), readGranted, copyText: (text) => ztools?.copyText?.(String(text)) });
}
if (typeof window !== 'undefined') window.contractGate = bridge(window.ztools);
module.exports = { bridge, __testGrant: grant, __testClear: clear, __testGrants: () => grants, readGranted };
