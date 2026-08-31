'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
test('renderer bridge is narrow and does not expose raw executable or path operations', async () => {
  global.window = { ztools: {} }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const api = global.window.subtitleWorkbench
  assert.equal(typeof api.consumeEntry, 'function')
  assert.equal(typeof api.startAudioExtract, 'function')
  assert.equal(api.runWhisper, undefined)
  assert.equal(api.extractAudio, undefined)
  assert.equal(api.onPluginEnter, undefined)
  const result = await api.startTranscription()
  assert.equal(result.code, 'TRANSCRIPTION_UNSUPPORTED')
  delete global.window
})
test('showOpenDialog accepts official string array result', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'subtitle-dialog-')); const file = path.join(directory, 'one.srt')
  await fs.writeFile(file, '1\n00:00:01,000 --> 00:00:02,000\nHi\n')
  global.window = { ztools: { showOpenDialog: async () => [file] } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const result = await global.window.subtitleWorkbench.chooseInput()
  assert.equal(result.ok, true); assert.equal(result.file.name, 'one.srt')
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('VTT transform keeps its input format by default', () => {
  global.window = { ztools: {} }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const value = global.window.subtitleWorkbench.transform('WEBVTT\n\n00:01.000 --> 00:02.000\nHi\n', 'vtt', { type: 'shift', milliseconds: 500 })
  assert.match(value, /^WEBVTT/); assert.match(value, /00:00:01\.500/)
  delete global.window
})
test('audio promotion replaces a final only after temp success', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-promote-')); const finalFile = path.join(directory, 'final.wav'); const temporary = path.join(directory, '.final.tmp.wav')
  await fs.writeFile(finalFile, 'old'); await fs.writeFile(temporary, 'new')
  global.window = { ztools: {} }; delete require.cache[require.resolve('../preload/services.cjs')]
  const service = require('../preload/services.cjs')
  await service.__test.promoteAudio(temporary, finalFile)
  assert.equal(await fs.readFile(finalFile, 'utf8'), 'new'); await fs.rm(directory, { recursive: true, force: true }); delete global.window
})
test('audio promotion restores old final when promote rename fails', async () => {
  const files = new Map([['final.wav', 'old'], ['temp.wav', 'new']]); const io = {
    async lstat() { return { isSymbolicLink: () => false } },
    async rename(from, to) { if (from === 'final.wav') { files.set('backup', files.get('final.wav')); files.delete('final.wav'); return } if (from === 'temp.wav' && to === 'final.wav') throw new Error('promote failed'); if (from.startsWith('final.wav.ztools-backup-') && to === 'final.wav') { files.set('final.wav', files.get('backup')); files.delete('backup') } },
    async rm() {}
  }
  global.window = { ztools: {} }; delete require.cache[require.resolve('../preload/services.cjs')]
  const service = require('../preload/services.cjs')
  await assert.rejects(service.__test.promoteAudio('temp.wav', 'final.wav', io), /promote failed/)
  assert.equal(files.get('final.wav'), 'old'); delete global.window
})
test('audio cancel uses PromiseLike kill and cleans the temporary WAV after rejection', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-cancel-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media')
  let rejectJob, killed = false, argv; const job = new Promise((resolve, reject) => { rejectJob = reject }); job.kill = () => { killed = true }
  global.window = { ztools: { showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: args => { argv = args; return job } } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  assert.equal(argv[0], '-n'); assert.ok(!argv.includes('-y')); assert.match(argv.at(-1), /\.wav$/)
  await global.window.subtitleWorkbench.cancelAudio(started.jobId); assert.equal(killed, true); rejectJob(new Error('killed')); await new Promise(resolve => setImmediate(resolve))
  assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'canceled'); assert.deepEqual((await fs.readdir(directory)).filter(name => name.includes('.ztools-')), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('plugin exit cancels a running audio job and a later resolve cannot promote it', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-exit-')); const input = path.join(directory, 'input.wav'); const output = path.join(directory, 'output.wav'); await fs.writeFile(input, 'media'); await fs.writeFile(output, 'old')
  let resolveJob, out, outCallback; const job = new Promise(resolve => { resolveJob = resolve }); job.kill = () => {}
  global.window = { ztools: { showOpenDialog: async () => [input], showSaveDialog: async () => output, runFFmpeg: args => { out = args.at(-1); return job }, onPluginOut: callback => { outCallback = callback } } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const selected = await global.window.subtitleWorkbench.chooseInput(); const started = await global.window.subtitleWorkbench.startAudioExtract(selected.file.grantId)
  const temporary = out
  assert.equal(typeof outCallback, 'function'); outCallback(); resolveJob(); await new Promise(resolve => setImmediate(resolve))
  assert.equal(await fs.readFile(output, 'utf8'), 'old'); assert.equal(global.window.subtitleWorkbench.audioJobStatus(started.jobId).state, 'unknown'); if (temporary) assert.deepEqual((await fs.readdir(directory)).filter(name => name.includes('.ztools-')), [])
  delete global.window; await fs.rm(directory, { recursive: true, force: true })
})
test('backup cleanup failure does not reverse a completed audio promote', async () => {
  const files = new Map([['final.wav', 'old'], ['temp.wav', 'new']]); const io = {
    async lstat() { return { isSymbolicLink: () => false } },
    async rename(from, to) { if (from === 'final.wav') { files.set('backup', files.get('final.wav')); files.delete('final.wav'); return } if (from === 'temp.wav' && to === 'final.wav') { files.set('final.wav', files.get('temp.wav')); files.delete('temp.wav') } },
    async rm() { throw new Error('cleanup failed') }
  }
  global.window = { ztools: {} }; delete require.cache[require.resolve('../preload/services.cjs')]
  const service = require('../preload/services.cjs'); await service.__test.promoteAudio('temp.wav', 'final.wav', io)
  assert.equal(files.get('final.wav'), 'new'); delete global.window
})
