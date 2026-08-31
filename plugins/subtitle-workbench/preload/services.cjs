'use strict'
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const core = require('./subtitle-core.cjs')
const MAX_SUBTITLE_BYTES = 15 * 1024 * 1024
const MAX_MEDIA_BYTES = 4 * 1024 * 1024 * 1024
const MAX_GRANTS = 20
const SUBTITLE_EXTENSIONS = new Set(['.srt', '.vtt'])
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.mkv', '.mp3', '.wav'])
const grants = new Map()
const entryQueue = []
const audioJobs = new Map()
function host() { return typeof window !== 'undefined' && window.ztools ? window.ztools : {} }
function makeId() { return crypto.randomBytes(12).toString('hex') }
function byteLength(value) { return Buffer.byteLength(String(value || ''), 'utf8') }
function dialogPath(result) { return Array.isArray(result) ? result[0] : typeof result === 'string' ? result : result && Array.isArray(result.filePaths) ? result.filePaths[0] : null }
function extension(value) { return path.extname(String(value || '')).toLowerCase() }
function clearSession() {
  grants.clear(); entryQueue.length = 0
  for (const record of audioJobs.values()) {
    record.state = 'canceling'
    try { if (record.job && typeof record.job.quit === 'function') record.job.quit(); else if (record.job && typeof record.job.kill === 'function') record.job.kill() } catch {}
    if (record.temporary) void fs.rm(record.temporary, { force: true }).catch(() => {})
  }
  audioJobs.clear()
}
async function validateFile(candidate, expectedType) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('Input file must be an absolute path')
  const first = await fs.lstat(candidate); if (!first.isFile() || first.isSymbolicLink()) throw new Error('Input must be a regular non-symlink file')
  const real = await fs.realpath(candidate); const entry = await fs.lstat(real); if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('Resolved input must be a regular file')
  const ext = extension(real); const type = SUBTITLE_EXTENSIONS.has(ext) ? 'subtitle' : MEDIA_EXTENSIONS.has(ext) ? 'media' : null
  if (!type || expectedType && type !== expectedType) throw new Error('Unsupported file extension for this operation')
  if (entry.size > (type === 'subtitle' ? MAX_SUBTITLE_BYTES : MAX_MEDIA_BYTES)) throw new RangeError('Input exceeds size limit')
  return { path: real, type, ext, size: entry.size, dev: entry.dev, ino: entry.ino, mtimeMs: entry.mtimeMs }
}
async function grantFile(candidate) {
  const checked = await validateFile(candidate)
  if (grants.size >= MAX_GRANTS) grants.delete(grants.keys().next().value)
  const id = makeId(); grants.set(id, { ...checked, expiresAt: Date.now() + 30 * 60 * 1000 })
  return { grantId: id, type: checked.type, name: path.basename(checked.path), size: checked.size, extension: checked.ext }
}
async function getGrant(id, expected) {
  const grant = grants.get(id); if (!grant || grant.expiresAt < Date.now()) { grants.delete(id); throw new Error('File authorization has expired') }
  const checked = await validateFile(grant.path, expected)
  if (checked.path !== grant.path || checked.type !== grant.type || checked.dev !== grant.dev || checked.ino !== grant.ino || checked.mtimeMs !== grant.mtimeMs) { grants.delete(id); throw new Error('Authorized file changed after selection') }
  grant.size = checked.size
  return grant
}
async function chooseInput() {
  const api = host(); if (typeof api.showOpenDialog !== 'function') return { ok: false, code: 'DIALOG_UNAVAILABLE' }
  const selected = dialogPath(await api.showOpenDialog({ title: '选择一个字幕或媒体文件', properties: ['openFile'], filters: [{ name: '字幕或媒体', extensions: ['srt', 'vtt', 'mp4', 'mov', 'mkv', 'mp3', 'wav'] }] }))
  if (!selected) return { ok: false, code: 'CANCELED' }
  return { ok: true, file: await grantFile(selected) }
}
async function queueEntry(payload) {
  const api = host(); const file = Array.isArray(payload) ? payload[0] : null
  if (!file || typeof api.getPathForFile !== 'function') return
  try { const nativePath = await api.getPathForFile(file); entryQueue.push({ ok: true, file: await grantFile(nativePath) }) }
  catch (error) { entryQueue.push({ ok: false, code: 'ENTRY_REJECTED', message: String(error.message || error).slice(0, 160) }) }
}
function consumeEntry() { return entryQueue.shift() || { ok: false, code: 'NO_ENTRY' } }
async function readGrantedSubtitle(id) {
  const grant = await getGrant(id, 'subtitle'); const handle = await fs.open(grant.path, 'r'); let content
  try { const identity = await handle.stat(); if (identity.dev !== grant.dev || identity.ino !== grant.ino || identity.mtimeMs !== grant.mtimeMs || identity.size !== grant.size) throw new Error('Authorized file changed before read'); content = await handle.readFile({ encoding: 'utf8' }) } finally { await handle.close() }
  if (byteLength(content) > MAX_SUBTITLE_BYTES) throw new RangeError('Input exceeds text limit')
  return { name: path.basename(grant.path), format: grant.ext.slice(1), content }
}
function analyze(content, format, options) {
  if (byteLength(content) > MAX_SUBTITLE_BYTES) throw new RangeError('Subtitle text exceeds limit')
  const normalized = format === 'vtt' ? 'vtt' : 'srt'; const cues = core.parse(content, normalized)
  return { cues, findings: core.qualityCheck(cues, options || {}) }
}
function transform(content, format, operation) {
  const input = operation && typeof operation === 'object' ? operation : {}; const result = analyze(content, format)
  let cues = result.cues
  if (input.type === 'shift') cues = core.shift(cues, Number(input.milliseconds))
  else if (input.type === 'speed') cues = core.scale(cues, Number(input.speed))
  else if (input.type === 'fps') { const source = Number(input.sourceFps); const target = Number(input.targetFps); if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0 || source > 240 || target > 240) throw new RangeError('Invalid frame rates'); cues = core.scale(cues, target / source) }
  else throw new Error('Unknown subtitle transform')
  const outputFormat = input.format || format
  return outputFormat === 'vtt' ? core.toVtt(cues) : core.toSrt(cues)
}
async function writeAtomically(destination, content) {
  const temporary = destination + '.ztools-' + crypto.randomBytes(6).toString('hex') + '.tmp'
  try { await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 }); await fs.rename(temporary, destination) }
  finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
}
async function saveSubtitle(content, format, name) {
  if (byteLength(content) > MAX_SUBTITLE_BYTES) throw new RangeError('Subtitle text exceeds limit')
  const kind = format === 'vtt' ? 'vtt' : 'srt'; const api = host(); if (typeof api.showSaveDialog !== 'function') throw new Error('Save dialog is unavailable')
  const fallback = String(name || 'subtitle').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\.(?:srt|vtt)$/i, '') + '.' + kind
  const chosen = await api.showSaveDialog({ title: '保存字幕', defaultPath: fallback, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] })
  const destination = typeof chosen === 'string' ? chosen : chosen && !chosen.canceled ? chosen.filePath : null
  if (!destination || !path.isAbsolute(destination)) return { canceled: true }
  try { const prior = await fs.lstat(destination); if (prior.isSymbolicLink()) throw new Error('Refusing to overwrite a symlink') } catch (error) { if (error && error.code !== 'ENOENT') throw error }
  await writeAtomically(destination, content)
  return { canceled: false, fileName: path.basename(destination) }
}
function getCapabilities() {
  const api = host()
  return { ffmpeg: typeof api.runFFmpeg === 'function', ffmpegCancel: false, whisper: { verified: false, runnable: false }, transcription: 'v0.1 does not probe PATH or run transcription binaries. Configure and run a future explicit adapter instead.' }
}
async function promoteAudio(temporary, output, io) {
  const disk = io || fs
  let backup = null; let promoted = false
  try {
    const existing = await disk.lstat(output)
    if (existing.isSymbolicLink()) throw new Error('Refusing to overwrite a symlink')
    backup = output + '.ztools-backup-' + makeId()
    await disk.rename(output, backup)
  } catch (error) { if (error && error.code !== 'ENOENT') throw error }
  try {
    await disk.rename(temporary, output); promoted = true
    if (backup) await disk.rm(backup, { force: true }).catch(() => {})
    return { warning: false }
  }
  catch (error) {
    if (backup) { try { await disk.rename(backup, output) } catch {} }
    throw error
  } finally { if (backup && promoted) await disk.rm(backup, { force: true }).catch(() => {}) }
}
async function startAudioExtract(id) {
  let grant = await getGrant(id, 'media'); const api = host(); if (typeof api.runFFmpeg !== 'function') return { ok: false, code: 'FFMPEG_UNAVAILABLE' }
  if (typeof api.showSaveDialog !== 'function') throw new Error('Save dialog is unavailable')
  const chosen = await api.showSaveDialog({ title: '导出音轨', defaultPath: path.basename(grant.path, grant.ext) + '.wav', filters: [{ name: 'WAV', extensions: ['wav'] }] })
  const output = typeof chosen === 'string' ? chosen : chosen && !chosen.canceled ? chosen.filePath : null
  if (!output || !path.isAbsolute(output)) return { ok: false, code: 'CANCELED' }
  try { const prior = await fs.lstat(output); if (prior.isSymbolicLink()) throw new Error('Refusing to overwrite a symlink') } catch (error) { if (error && error.code !== 'ENOENT') throw error }
  grant = await getGrant(id, 'media')
  if (path.resolve(output) === path.resolve(grant.path)) throw new Error('Audio output must differ from input')
  if (audioJobs.size >= MAX_GRANTS) { for (const [key, value] of audioJobs) { if (value.state !== 'running' && value.state !== 'canceling') audioJobs.delete(key) } if (audioJobs.size >= MAX_GRANTS) throw new Error('Too many retained audio jobs') }
  const suffix = path.extname(output) || '.wav'; const temporary = path.join(path.dirname(output), '.' + path.basename(output, suffix) + '.ztools-' + makeId() + suffix)
  try { await fs.lstat(temporary); throw new Error('Temporary output collision') } catch (error) { if (error && error.code !== 'ENOENT') throw error }
  const idValue = makeId(); const job = api.runFFmpeg(['-n', '-i', grant.path, '-vn', '-acodec', 'pcm_s16le', temporary], undefined)
  const record = { job, temporary, output, state: 'running', message: '' }; audioJobs.set(idValue, record)
  const finish = async (error) => {
    try {
      if (error || record.state === 'canceling') throw error || new Error('Audio extraction canceled')
      const promoted = await promoteAudio(temporary, output); record.state = 'completed'; record.warning = promoted && promoted.warning
    } catch (failure) { record.state = record.state === 'canceling' ? 'canceled' : 'failed'; record.message = String(failure && failure.message || failure).slice(0, 160); await fs.rm(temporary, { force: true }).catch(() => {}) }
    const cleanupTimer = setTimeout(() => audioJobs.delete(idValue), 5 * 60 * 1000); if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref()
  }
  Promise.resolve(job).then(() => finish(), error => finish(error))
  return { ok: true, jobId: idValue, cancelSupported: Boolean(job && (typeof job.quit === 'function' || typeof job.kill === 'function')) }
}
function audioJobStatus(jobId) { const record = audioJobs.get(jobId); if (!record) return { state: 'unknown' }; return { state: record.state, message: record.message } }
async function cancelAudio(jobId) { const record = audioJobs.get(jobId); if (!record) throw new Error('Unknown audio job'); if (record.job && typeof record.job.quit === 'function') { record.job.quit(); record.state = 'canceling'; return { ok: true } } if (record.job && typeof record.job.kill === 'function') { record.job.kill(); record.state = 'canceling'; return { ok: true } } return { ok: false, code: 'CANCEL_UNAVAILABLE' } }
async function startTranscription() { return { ok: false, code: 'TRANSCRIPTION_UNSUPPORTED', message: 'v0.1 不探测 PATH，也不执行 Python whisper 或 whisper.cpp。' } }
function registerLifecycle() {
  const api = host()
  if (typeof api.onPluginEnter === 'function') api.onPluginEnter(({ type, payload } = {}) => { if (type === 'files') void queueEntry(payload) })
  if (typeof api.onPluginOut === 'function') api.onPluginOut(clearSession)
}
registerLifecycle()
window.subtitleWorkbench = Object.freeze({ consumeEntry, chooseInput, readGrantedSubtitle, analyze, transform, saveSubtitle, getCapabilities, startAudioExtract, audioJobStatus, cancelAudio, startTranscription })
module.exports = Object.freeze({ __test: { promoteAudio } })
