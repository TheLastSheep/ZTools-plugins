const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const filename = path.join(__dirname, '..', 'src', 'themes.ts')
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename,
}).outputText
const themesModule = { exports: {} }
new Function('exports', 'module', compiled)(themesModule.exports, themesModule)
const themes = themesModule.exports

test('blue follows the system palette while black and white remain fixed, complete normalized snapshots', () => {
  const light = themes.getBuiltInThemes(false)
  const dark = themes.getBuiltInThemes(true)
  assert.deepEqual(light.map((theme) => theme.id), ['blue', 'black', 'white'])
  assert.deepEqual(light[1], dark[1])
  assert.deepEqual(light[2], dark[2])
  assert.equal(light[0].colors.editorBackground, '#FFFFFF')
  assert.equal(dark[0].colors.editorBackground, '#182235')
  assert.equal(light[1].colors.editorBackground, '#1A1A1A')
  assert.equal(light[2].colors.editorBackground, '#FFFFFF')
  for (const theme of [...light, ...dark]) {
    assert.deepEqual(Object.keys(theme.colors).sort(), [...themes.themeColorKeys].sort())
    for (const color of Object.values(theme.colors)) assert.match(color, /^#[0-9A-F]{6}$/)
  }
  light[0].colors.editorText = '#000000'
  assert.equal(themes.getBuiltInThemes(false)[0].colors.editorText, '#172033')
})

test('theme resolution falls back to blue and returns copies independent of custom themes', () => {
  const customTheme = { id: 'custom:test', name: '测试', colors: themes.getBuiltInThemes(false)[0].colors }
  assert.equal(themes.resolveTheme('unknown', [customTheme], true).id, 'blue')
  const resolved = themes.resolveTheme(customTheme.id, [customTheme], false)
  assert.deepEqual(resolved, customTheme)
  resolved.colors.editorText = '#AABBCC'
  assert.equal(customTheme.colors.editorText, '#172033')
})

test('hex normalization accepts optional hash and rejects CSS expressions or incomplete colors', () => {
  for (const value of ['#aBc123', 'abc123', '  #abc123  ']) assert.equal(themes.normalizeHexColor(value), '#ABC123')
  for (const value of [null, 42, '#abc', '#abcd1234', 'red', '#ffffff; color:red', 'var(--x)']) assert.equal(themes.normalizeHexColor(value), null)
})

test('darkness uses relative luminance for saturated colors as well as neutral backgrounds', () => {
  for (const color of ['#000000', '#1A1A1A', '#0000FF', '#182235']) assert.equal(themes.isDarkColor(color), true)
  for (const color of ['#FFFFFF', '#00FF00', '#FFFF00', '#FF0000']) assert.equal(themes.isDarkColor(color), false)
  assert.equal(themes.isDarkColor('invalid'), false)
})

test('stored custom theme names are trimmed and deduplicated case-insensitively including builtins', () => {
  const colors = themes.getBuiltInThemes(false)[0].colors
  const records = [
    { id: 'custom:first', name: '  My Theme  ', colors },
    { id: 'custom:duplicate', name: 'my THEME', colors },
    ...themes.getBuiltInThemes(false).map((theme) => ({ id: `custom:${theme.id}`, name: ` ${theme.name} `, colors })),
    { id: 'custom:invalid', name: 'Second', colors: { ...colors, popupText: 'invalid' } },
    { id: 'custom:second', name: 'Second', colors },
  ]
  assert.deepEqual(themes.normalizeCustomThemes(records), [
    { id: 'custom:first', name: 'My Theme', colors },
    { id: 'custom:second', name: 'Second', colors },
  ])
})
