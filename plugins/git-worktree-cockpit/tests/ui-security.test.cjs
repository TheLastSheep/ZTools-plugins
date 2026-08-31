'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
test('worktree UI renders runtime values through textContent, never innerHTML', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  assert.match(html, /textContent=String\(value/)
  assert.ok(!html.includes('.innerHTML'))
})
