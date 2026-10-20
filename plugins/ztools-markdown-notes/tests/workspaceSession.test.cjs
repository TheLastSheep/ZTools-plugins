const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

function createSession(storedSettings, writeError) {
  const storage = new Map([['editor-settings', storedSettings]])
  const writes = []
  const filename = path.join(__dirname, '..', 'src', 'workspaceSession.ts')
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  const window = { ztools: { dbStorage: {
    getItem: (key) => storage.get(key),
    setItem: (key, value) => {
      if (writeError) throw writeError
      writes.push(key)
      storage.set(key, value)
    },
  } } }
  const themesFilename = path.join(__dirname, '..', 'src', 'themes.ts')
  const themesCompiled = ts.transpileModule(fs.readFileSync(themesFilename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: themesFilename,
  }).outputText
  const themesModule = { exports: {} }
  new Function('exports', 'module', themesCompiled)(themesModule.exports, themesModule)
  new Function('exports', 'module', 'window', 'require', compiled)(module.exports, module, window, () => themesModule.exports)
  module.exports.themes = themesModule.exports
  module.exports.storage = storage
  module.exports.writes = writes
  return module.exports
}

test('old settings and invalid background choices fall back to blue without losing global preferences', () => {
  for (const backgroundTheme of [undefined, null, 'unknown', 1]) {
    const session = createSession({ backgroundTheme, fontSize: 20, lineHeight: 1.8 })
    const settings = session.loadEditorSettings()
    assert.equal(settings.themeId, 'blue')
    assert.deepEqual(settings.customThemes, [])
    assert.equal(settings.fontSize, 20)
    assert.equal(settings.lineHeight, 1.8)
  }
  assert.deepEqual(createSession(null).loadEditorSettings(), createSession(null).defaultEditorSettings)
})

test('old builtin choices migrate and new choices survive saving and reopening without changing globals', () => {
  const session = createSession(null)
  for (const themeId of ['blue', 'black', 'white']) {
    assert.equal(createSession({ backgroundTheme: themeId, findHighlightColor: 'facc15' }).loadEditorSettings().themeId, themeId)
    session.saveEditorSettings({ ...session.defaultEditorSettings, themeId, fontSize: 18, lineHeight: 1.8, textHighlightOpacity: 70 })
    assert.equal(session.loadEditorSettings().themeId, themeId)
    assert.equal(session.loadEditorSettings().fontSize, 18)
    assert.equal(session.loadEditorSettings().lineHeight, 1.8)
    assert.equal(session.loadEditorSettings().textHighlightOpacity, 70)
  }
  session.saveEditorSettings(session.defaultEditorSettings)
  assert.deepEqual(session.loadEditorSettings(), session.defaultEditorSettings)
})

test('changed legacy highlight colors become a stable custom snapshot with system palette and global settings preserved', () => {
  for (const backgroundTheme of ['blue', 'black', 'white']) {
    const session = createSession({ backgroundTheme, textHighlightColor: ' 12abef ', findHighlightColor: '#abc123', fontSize: 22, lineHeight: 2, textHighlightOpacity: 30 })
    const settings = session.loadEditorSettings(true)
    const expectedColors = session.themes.resolveTheme(backgroundTheme, [], true).colors
    assert.equal(settings.themeId, 'custom:legacy')
    assert.deepEqual(settings.customThemes, [{ id: 'custom:legacy', name: '原有配色', colors: {
      ...expectedColors, textHighlightColor: '#12ABEF', findHighlightColor: '#ABC123',
    } }])
    assert.equal(settings.fontSize, 22)
    assert.equal(settings.lineHeight, 2)
    assert.equal(settings.textHighlightOpacity, 30)
    session.saveEditorSettings(settings)
    assert.deepEqual(session.loadEditorSettings(false), settings)
    assert.equal(session.storage.size, 1)
    assert.equal(Object.hasOwn(session.storage.get('editor-settings'), 'backgroundTheme'), false)
  }
})

test('custom themes save normalized complete colors and reopening returns independent copies', () => {
  const session = createSession(null)
  const colors = Object.fromEntries(session.themes.themeColorKeys.map((key) => [key, 'abcdef']))
  const customTheme = { id: 'custom:my-theme', name: '  我的主题  ', colors }
  session.saveEditorSettings({ ...session.defaultEditorSettings, themeId: customTheme.id, customThemes: [customTheme], fontSize: 20 })
  colors.editorBackground = '#000000'
  const settings = session.loadEditorSettings()
  assert.equal(settings.themeId, customTheme.id)
  assert.equal(settings.customThemes[0].name, '我的主题')
  assert.deepEqual(settings.customThemes[0].colors, Object.fromEntries(session.themes.themeColorKeys.map((key) => [key, '#ABCDEF'])))
  settings.customThemes[0].colors.editorBackground = '#FFFFFF'
  settings.customThemes.push(customTheme)
  assert.equal(session.loadEditorSettings().customThemes.length, 1)
  assert.equal(session.loadEditorSettings().customThemes[0].colors.editorBackground, '#ABCDEF')
  assert.deepEqual(session.defaultEditorSettings.customThemes, [])
})

test('legacy custom snapshot persists once on first load and stays fixed when the system palette changes', () => {
  const session = createSession({ backgroundTheme: 'blue', findHighlightColor: '#123456', fontSize: 20, lineHeight: 1.8, textHighlightOpacity: 60 })
  const first = session.loadEditorSettings(true)
  assert.equal(first.customThemes[0].colors.editorBackground, '#182235')
  assert.deepEqual(session.storage.get('editor-settings'), first)
  assert.equal(Object.hasOwn(session.storage.get('editor-settings'), 'backgroundTheme'), false)
  assert.deepEqual(session.loadEditorSettings(false), first)
  assert.deepEqual(session.writes, ['editor-settings'])
  first.customThemes[0].colors.editorBackground = '#FFFFFF'
  assert.equal(session.loadEditorSettings(false).customThemes[0].colors.editorBackground, '#182235')
})

test('normal settings loads stay read-only and migration write failures propagate', () => {
  for (const stored of [null, { backgroundTheme: 'blue', findHighlightColor: '#FACC15' }, { themeId: 'white', customThemes: [] }]) {
    const session = createSession(stored)
    session.loadEditorSettings(true)
    session.loadEditorSettings(false)
    assert.deepEqual(session.writes, [])
  }
  const error = new Error('Storage write failed')
  const session = createSession({ backgroundTheme: 'blue', findHighlightColor: '#123456' }, error)
  assert.throws(() => session.loadEditorSettings(true), (caught) => caught === error)
})

test('invalid theme records, IDs, duplicates and missing selection cannot enter persisted settings', () => {
  const session = createSession(null)
  const colors = session.themes.getBuiltInThemes(false)[0].colors
  const valid = { id: 'custom:ok', name: '有效', colors }
  const invalidThemes = [
    null, 1, [], { ...valid, id: 'blue' }, { ...valid, id: '__proto__' },
    { ...valid, id: 'custom:' }, { ...valid, id: 'custom:bad id' },
    { ...valid, name: ' ' }, { ...valid, name: 'a'.repeat(41) },
    { ...valid, colors: { ...colors, editorText: 'red; background:url(x)' } },
    { ...valid, colors: { ...colors, popupText: undefined } },
    Object.create(valid), { ...valid, colors: Object.create(colors) },
  ]
  const duplicate = { ...valid, name: '重复', colors: { ...colors, editorText: '#111111' } }
  for (const selected of ['custom:missing', 'constructor', '__proto__', null]) {
    const stored = { ...session.defaultEditorSettings, themeId: selected, customThemes: [...invalidThemes, valid, duplicate] }
    assert.deepEqual(createSession(stored).loadEditorSettings().customThemes, [valid])
    session.saveEditorSettings(stored)
    const settings = session.loadEditorSettings()
    assert.equal(settings.themeId, 'blue')
    assert.deepEqual(settings.customThemes, [valid])
  }
})

test('malformed persisted settings keep safe defaults and independently validate global ranges', () => {
  for (const stored of [undefined, null, false, 10, 'blue', [], Object.create({ fontSize: 20 })]) {
    const session = createSession(stored)
    assert.deepEqual(session.loadEditorSettings(), session.defaultEditorSettings)
  }
  for (const value of [NaN, Infinity, -1, 1000, '20']) {
    const session = createSession({ themeId: 'white', fontSize: value, lineHeight: value, textHighlightOpacity: value })
    assert.deepEqual(session.loadEditorSettings(), { ...session.defaultEditorSettings, themeId: 'white' })
  }
  const legacy = createSession({ backgroundTheme: 'black', textHighlightColor: 'url(x)', findHighlightColor: '#abcd' }).loadEditorSettings()
  assert.equal(legacy.themeId, 'black')
  assert.deepEqual(legacy.customThemes, [])
})
