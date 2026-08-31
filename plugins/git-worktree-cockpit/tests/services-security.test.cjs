'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
test('renderer bridge only accepts authorization ids, not repository or executable paths', () => {
  global.window = { ztools: {} }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  const api = global.window.gitWorktreeCockpit
  assert.equal(typeof api.inspectGrant, 'function')
  assert.equal(api.inspect, undefined)
  assert.equal(api.resolveGit, undefined)
  assert.equal(api.gitCandidates, undefined)
  delete global.window
})
test('showOpenDialog accepts official string array result', async () => {
  global.window = { ztools: { showOpenDialog: async () => ['/definitely-not-a-repository'] } }
  delete require.cache[require.resolve('../preload/services.cjs')]
  require('../preload/services.cjs')
  await assert.rejects(global.window.gitWorktreeCockpit.chooseRepository(), /ENOENT/)
  delete global.window
})
