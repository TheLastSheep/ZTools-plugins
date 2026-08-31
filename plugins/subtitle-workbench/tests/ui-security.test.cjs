'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
test('subtitle findings are rendered via DOM textContent, not HTML templates', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  assert.match(html, /n\.textContent='#'\+\(item\.index\+1\)/)
  assert.ok(!html.includes('.innerHTML'))
})
test('audio polling handles canceled as a terminal user-visible state', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  assert.match(html, /'canceled'/)
  assert.match(html, /音轨提取已取消/)
})
