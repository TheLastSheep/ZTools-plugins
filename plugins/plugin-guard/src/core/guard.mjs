import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
const LIMITS = Object.freeze({ depth: 12, files: 1600, bytes: 24 * 1024 * 1024 });
const KNOWN_BRIDGE = new Set(['choosePluginDirectory','scan','copyText']);
const FEATURE_CODES = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SECRET = /(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|secret|token)\s*[:=]\s*['\"]?[A-Za-z0-9_.-]{12,})/gi;
const RISKY = [
  ['dynamic-require', /require\s*\(\s*[^'"\s]/, 'high'], ['eval', /\beval\s*\(|\bFunction\s*\(/, 'high'],
  ['child-process', /require\s*\(\s*['\"]child_process|\bexec(?:Sync|File)?\s*\(/, 'medium'], ['shell', /shell\s*:\s*true|exec\s*\(\s*[`'"]/, 'high'],
  ['whole-module-bridge', /(?:globalThis|window)\.[\w$]+\s*=\s*(?:require\(|(?:fs|child_process)\b)/, 'high'], ['remote-url', /https?:\/\//i, 'low']
];
const BRIDGE_FIELD = /\bbridge\.([A-Za-z_$][\w$]*)\s*=/g;
function issue(level, code, message, file) { return { level, code, message, ...(file ? { file } : {}) }; }
function within(root, candidate) { const rel = path.relative(root, candidate); return rel && !rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel); }
export function safeRelative(value) { return typeof value === 'string' && value.length > 0 && !value.includes('\0') && !path.isAbsolute(value) && !/^(?:[A-Za-z]:[\\/]|\\\\)/.test(value) && !value.split(/[\\/]+/).includes('..'); }
export function maskSecrets(text) { return String(text).replace(SECRET, (m) => `${m.slice(0, Math.min(4,m.length))}…[masked]`); }
async function collect(root, state, directory = root, depth = 0) {
  const before=await lstat(directory); if(before.isSymbolicLink()||!before.isDirectory()||await realpath(directory)!==directory) { state.issues.push(issue('high','directory-race','Directory became unsafe while scanning.',path.relative(root,directory))); return; }
  if (depth > state.limits.depth) { state.issues.push(issue('high','depth-limit','Directory depth exceeds limit.',path.relative(root,directory))); return; }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name); const rel = path.relative(root, full); const info = await lstat(full);
    if (info.isSymbolicLink()) { state.issues.push(issue('high','symlink','Symbolic links are not scanned.',rel)); continue; }
    if (info.isDirectory()) { await collect(root,state,full,depth+1); continue; }
    if (!info.isFile()) { state.issues.push(issue('medium','special-file','Special filesystem entry ignored.',rel)); continue; }
    state.files += 1; state.bytes += info.size;
    if (state.files > state.limits.files || state.bytes > state.limits.bytes) throw new RangeError('Scan safety limit exceeded.');
    const key = rel.normalize('NFC').toLocaleLowerCase('en-US'); if (state.caseKeys.has(key)) state.issues.push(issue('high','case-collision','Case or Unicode-colliding paths are unsafe across platforms.',rel)); state.caseKeys.add(key);
    state.entries.push({ rel, size: info.size });
  }
  const after=await lstat(directory); if(after.isSymbolicLink()||!after.isDirectory()||await realpath(directory)!==directory) state.issues.push(issue('high','directory-race','Directory changed while scanning.',path.relative(root,directory)));
}
async function readAuditedFile(full) { const before=await lstat(full); if(before.isSymbolicLink()||!before.isFile()) throw new Error('Unsafe file entry.'); const flags=fsConstants.O_RDONLY|(process.platform==='win32'?0:(fsConstants.O_NOFOLLOW||0)); const handle=await open(full,flags); try { const held=await handle.stat(); if(!held.isFile()||(before.ino&&held.ino&&before.ino!==held.ino)||(before.dev&&held.dev&&before.dev!==held.dev)) throw new Error('File changed while opening.'); const source=await handle.readFile({encoding:'utf8'}); const after=await lstat(full); if(after.isSymbolicLink()||(held.ino&&after.ino&&held.ino!==after.ino)||(held.dev&&after.dev&&held.dev!==after.dev)) throw new Error('File changed while reading.'); return source; } finally { await handle.close(); } }
function validateManifest(manifest, entries, issues) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return issues.push(issue('high','manifest','plugin.json must be an object.'));
  for (const key of ['name','version','author','logo']) if (typeof manifest[key] !== 'string' || !manifest[key].trim()) issues.push(issue('high','manifest-field',`Missing or invalid ${key}.`));
  if (!manifest.main && !manifest.preload) issues.push(issue('high','entrypoint','Manifest needs a main or preload entrypoint.'));
  for (const key of ['main','logo','preload']) if (manifest[key] && (!safeRelative(manifest[key]) || !entries.has(manifest[key]))) issues.push(issue('high','entrypoint',`Unsafe or missing ${key}: ${String(manifest[key])}.`));
  const allowedCategories = new Set(['productivity','development','system','media','text','network','game','other']); if (!Array.isArray(manifest.categories) || manifest.categories.some((item)=>!allowedCategories.has(item))) issues.push(issue('medium','categories','Categories contain an unknown or non-portable key.'));
  if (!Array.isArray(manifest.platform) || !['darwin','win32','linux'].every((p)=>manifest.platform.includes(p))) issues.push(issue('medium','platform','Manifest should explicitly cover darwin, win32, and linux.'));
  if (!Array.isArray(manifest.features)) { issues.push(issue('high','feature-list','features must be an array.')); return; }
  const seen = new Set(); for (const feature of manifest.features) { if (!feature || !FEATURE_CODES.test(feature.code || '') || seen.has(feature.code)) issues.push(issue('high','feature-code','Feature codes must be unique and narrow.')); seen.add(feature?.code); if (!Array.isArray(feature?.cmds) || feature.cmds.some((x)=>{if(typeof x==='string')return !x.trim();if(!x||!['files','img','over'].includes(x.type)||!x.label)return true;if(x.type==='files')return !Number.isInteger(x.maxLength)||x.maxLength<1||(!Array.isArray(x.extensions)&&typeof x.match!=='string');if(x.type==='over')return !Number.isInteger(x.minLength)||!Number.isInteger(x.maxLength)||x.minLength<0||x.maxLength<x.minLength;return false;})) issues.push(issue('medium','feature-trigger','Feature trigger is missing or too broad.')); }
}
export async function scanPlugin(input, options = {}) {
  const inputInfo = await lstat(input); if (inputInfo.isSymbolicLink()) throw new TypeError('Plugin root cannot be a symbolic link.'); const root = await realpath(input); const rootInfo = await stat(root); if (!rootInfo.isDirectory()) throw new TypeError('Select a plugin directory, not a file.');
  const state = { limits:{...LIMITS,...(options.limits||{})}, entries:[], files:0, bytes:0, issues:[], caseKeys:new Set() }; await collect(root,state);
  const index = new Set(state.entries.map((x)=>x.rel)); let manifest;
  if (!index.has('plugin.json')) state.issues.push(issue('high','manifest','plugin.json is missing.')); else { try { manifest=JSON.parse(await readAuditedFile(path.join(root,'plugin.json'))); validateManifest(manifest,index,state.issues); } catch { state.issues.push(issue('high','manifest-json','plugin.json is not valid JSON.')); } }
  const risks=[]; for (const entry of state.entries.filter((x)=>/\.(?:cjs|mjs|js|json|html)$/i.test(x.rel))) { const full=path.join(root,entry.rel); if (!within(root,full)) { state.issues.push(issue('high','containment','Entry escaped root.',entry.rel)); continue; } let source; try { source=await readAuditedFile(full); } catch { risks.push(issue('high','incomplete-file-read','File could not be read safely in full.',entry.rel)); continue; } for(const [code,re,level] of RISKY) { re.lastIndex=0; if(re.test(source)) risks.push(issue(level,code,`Static pattern: ${code}.`,entry.rel)); } if(/preload/i.test(entry.rel)&&source.split(/\r?\n/).some((line)=>line.length>2000)) risks.push(issue('medium','minified-preload','Unreadable or bundled preload code widens audit risk.',entry.rel)); const req=/require\s*\(\s*['\"](\.[^'\"]+)['\"]\s*\)/g; let required; while((required=req.exec(source))){const base=path.resolve(path.dirname(full),required[1]),candidates=[base,`${base}.js`,`${base}.cjs`,`${base}.json`,path.join(base,'index.js'),path.join(base,'index.cjs'),path.join(base,'index.json')];if(!candidates.some((target)=>within(root,target))){risks.push(issue('high','relative-require-escape','Relative require escapes plugin root.',entry.rel));continue;}let found=false;for(const target of candidates.filter((target)=>within(root,target))){try{const info=await stat(target);if(info.isFile()){found=true;break}}catch{}}if(!found)risks.push(issue('high','missing-relative-require',`Relative require is not readable: ${required[1]}.`,entry.rel));} BRIDGE_FIELD.lastIndex=0; let field; while((field=BRIDGE_FIELD.exec(source))) if(!KNOWN_BRIDGE.has(field[1])) risks.push(issue('high','unknown-bridge',`Unknown bridge field ${field[1]} is fail-closed.`,entry.rel)); SECRET.lastIndex=0; if(SECRET.test(source)) risks.push(issue('high','secret','Possible credential found; value masked in report.',entry.rel)); }
  const clean=(finding)=>({ ...finding, ...(finding.file?{file:maskSecrets(finding.file)}:{}), message:maskSecrets(finding.message) }); return { root, manifest: manifest ? { name:maskSecrets(manifest.name),version:maskSecrets(manifest.version),features:Array.isArray(manifest.features)?manifest.features.map((feature)=>({code:maskSecrets(feature?.code||'')})):[] } : null, files:state.files, bytes:state.bytes, issues:state.issues.map(clean), risks:risks.map(clean), entries:state.entries.map((x)=>({ ...x, rel:maskSecrets(x.rel) })), scannedAt:new Date().toISOString() };
}
function markdownText(value) { return maskSecrets(value).replace(/[\r\n\t]+/g,' ').replace(/\\/g,'\\\\').replace(/([`*_[\]<>#])/g,'\\$1'); }
function markdownCode(value) { return maskSecrets(value).replace(/[\r\n\t]+/g,' ').replace(/`/g,'ˋ'); }
export function toMarkdown(report) { const rows=['# Plugin Guard report','','Scanned: '+markdownText(report.scannedAt),'Files: '+Number(report.files||0)+'; bytes: '+Number(report.bytes||0),'','## Findings']; for(const x of [...report.issues,...report.risks]) rows.push('- `'+markdownCode(x.level)+'` `'+markdownCode(x.code)+'`'+(x.file?' — `'+markdownCode(x.file)+'`':'')+': '+markdownText(x.message)); return rows.join('\n'); }
export { LIMITS, KNOWN_BRIDGE };
