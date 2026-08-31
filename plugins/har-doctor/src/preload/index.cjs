const fs = require('fs');
const path = require('path');
const MAX = 20 * 1024 * 1024, TTL = 300000;
let grants = [];
function close(record) { try { fs.closeSync(record.fd); } catch {} }
function clear() { for (const record of grants) close(record); grants = []; }
function meta(file) {
  const real = fs.realpathSync(file), link = fs.lstatSync(file);
  const fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try { const stat = fs.fstatSync(fd); if (link.isSymbolicLink() || !stat.isFile() || stat.size > MAX || !/\.har$/i.test(real)) throw Error('Rejected HAR file'); return { real, fd, size: stat.size, mtime: stat.mtimeMs, dev: stat.dev, ino: stat.ino, until: Date.now() + TTL }; }
  catch (error) { close({ fd }); throw error; }
}
function grant(files) {
  clear(); if (!Array.isArray(files) || files.length < 1 || files.length > 2) throw Error('Choose one or two HAR files');
  const selected = [];
  try { for (const file of files) selected.push(meta(file)); grants = selected; return grants.map((item) => path.basename(item.real)); }
  catch (error) { for (const item of selected) close(item); throw error; }
}
function read(record) {
  if (Date.now() > record.until) { clear(); throw Error('HAR selection expired'); }
  const stat = fs.fstatSync(record.fd); if (stat.size !== record.size || stat.mtimeMs !== record.mtime || stat.dev !== record.dev || stat.ino !== record.ino) throw Error('HAR file changed after selection');
  const output = Buffer.alloc(stat.size); let offset = 0;
  while (offset < output.length) { const count = fs.readSync(record.fd, output, offset, output.length - offset, offset); if (!count) throw Error('Incomplete HAR read'); offset += count; }
  return output.toString('utf8');
}
function readGranted() {
  if (!grants.length) throw Error('Choose HAR files first');
  try { return grants.map(read); }
  finally { clear(); }
}
async function choose(ztools) {
  if (typeof ztools?.showOpenDialog !== 'function') throw Error('ZTools file dialog unavailable');
  const result = await ztools.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'HAR', extensions: ['har'] }] });
  const files = Array.isArray(result) ? result : result?.filePaths; if (!files?.length) { clear(); return []; } return grant(files);
}
function bridge(ztools) { if (typeof ztools?.onPluginOut === 'function') ztools.onPluginOut(clear); return Object.freeze({ choose: () => choose(ztools), readGranted, copyText: (text) => ztools?.copyText?.(String(text)) }); }
if (typeof window !== 'undefined') window.harDoctor = bridge(window.ztools);
module.exports = { bridge, __testGrant: grant, __testClear: clear, __testGrants: () => grants, readGranted };
