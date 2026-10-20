const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const { parse, compileScript } = require('vue/compiler-sfc')

// A small renderer host lets the real SFCs and their DOM input directives run
// without adding a browser or replacing either component with a stub.
class HostNode {
  constructor(tag, text = '') {
    this.tag = tag
    this.tagName = tag.toUpperCase()
    this.text = text
    this.children = []
    this.parent = null
    this.props = {}
    this.style = {}
    this.listeners = {}
    markRaw(this)
  }
  addEventListener(name, listener) {
    ;(this.listeners[name] ??= []).push(listener)
  }
  removeEventListener(name, listener) {
    this.listeners[name] = (this.listeners[name] ?? []).filter((item) => item !== listener)
  }
  dispatch(name, event = {}) {
    const input = { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event }
    for (const listener of this.listeners[name] ?? []) listener(input)
    for (const listener of [this.props[`on${name[0].toUpperCase()}${name.slice(1)}`]].flat()) {
      if (listener) listener(input)
    }
  }
  focus() { document.activeElement = this }
  select() { this.selected = true }
  getAttribute(name) { return this.props[name] ?? null }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join('') }
}
class InputNode extends HostNode {}
class SelectNode extends HostNode {}
global.HTMLInputElement = InputNode
global.HTMLSelectElement = SelectNode
const { createRenderer, h, markRaw, nextTick, reactive, ref } = require('vue')
global.document = { activeElement: null }
const moduleCache = new Map()
function loadSource(filename) {
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports
  let source = fs.readFileSync(filename, 'utf8')
  if (filename.endsWith('.vue')) {
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    source = compileScript(descriptor, { id: path.basename(filename), inlineTemplate: true }).content
  }
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: `${filename}.ts`,
  }).outputText
  const module = { exports: {} }
  moduleCache.set(filename, module)
  const localRequire = (specifier) => specifier.startsWith('.')
    ? loadSource(path.resolve(path.dirname(filename), specifier.endsWith('.vue') ? specifier : `${specifier}.ts`))
    : require(specifier)
  new Function('require', 'exports', 'module', compiled)(localRequire, module.exports, module)
  return module.exports
}
const ThemeSettings = loadSource(path.join(__dirname, '..', 'src', 'components', 'ThemeSettings.vue')).default
const { getBuiltInThemes, themeColorKeys } = loadSource(path.join(__dirname, '..', 'src', 'themes.ts'))

function mountSettings(t, {
  activeTheme = getBuiltInThemes(false)[0], customThemes = [], systemDark = false,
  saveTheme, deleteTheme, acceptSelection = true,
} = {}) {
  const root = new HostNode('root')
  const body = new HostNode('body')
  function remove(node) {
    if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
    node.parent = null
  }
  const renderer = createRenderer({
    createElement: (tag) => tag === 'input' ? new InputNode(tag) : tag === 'select' ? new SelectNode(tag) : new HostNode(tag),
    createText: (text) => new HostNode('#text', text),
    createComment: (text) => new HostNode('#comment', text),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    patchProp: (node, key, previous, value) => {
      node.props[key] = value
      if (key === 'value' || key === 'type') node[key] = value
    },
    insert: (node, parent, anchor = null) => {
      remove(node)
      parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, node)
      node.parent = parent
    },
    remove,
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    querySelector: (selector) => selector === 'body' ? body : null,
  })
  const state = reactive({ activeTheme, customThemes, preview: null, noteCommands: 0 })
  const events = { select: [], save: [], delete: [], preview: [] }
  const component = ref(null)
  const app = renderer.createApp({
    setup: () => () => h(ThemeSettings, {
      ref: component, activeTheme: state.activeTheme, customThemes: state.customThemes, systemDark, saveTheme, deleteTheme,
      onSelect: (id) => {
        events.select.push(id)
        if (acceptSelection) state.activeTheme = [...getBuiltInThemes(systemDark), ...state.customThemes].find((theme) => theme.id === id)
      },
      onSave: (theme) => {
        events.save.push(theme)
        const index = state.customThemes.findIndex((item) => item.id === theme.id)
        if (index < 0) state.customThemes.push(theme)
        else state.customThemes[index] = theme
        state.activeTheme = theme
      },
      onDelete: (id) => { events.delete.push(id) },
      onPreview: (theme) => { events.preview.push(theme); state.preview = theme },
    }),
  })
  app.mount(root)
  t.after(() => app.unmount())
  const all = () => {
    const visit = (node) => [node, ...node.children.flatMap(visit)]
    return [...visit(root), ...visit(body)]
  }
  const find = (predicate) => {
    const node = all().find(predicate)
    assert.ok(node, 'Expected rendered control to exist')
    return node
  }
  const byId = (id) => find((node) => node.props.id === id)
  const button = (label) => find((node) => node.tag === 'button' && node.textContent === label)
  const click = async (label) => { button(label).dispatch('click'); await nextTick() }
  const input = async (id, value) => {
    const node = byId(id)
    node.value = value
    node.dispatch('input')
    await nextTick()
  }
  const choose = async (id) => {
    const picker = byId('appearance-theme-picker')
    picker.value = id
    picker.dispatch('change')
    await nextTick()
  }
  const submit = async () => { find((node) => node.tag === 'form').dispatch('submit'); await nextTick() }
  const shortcut = async (key, ctrlKey = false) => {
    const event = {
      key, ctrlKey, prevented: false, stopped: false,
      preventDefault() { this.prevented = true },
      stopImmediatePropagation() { this.stopped = true },
    }
    // The parent routes shortcuts through this exposed handler before note commands.
    const handled = component.value.handleShortcut(event)
    if (!handled) state.noteCommands++
    await nextTick()
    return { event, handled }
  }
  return { state, events, all, byId, button, click, input, choose, submit, shortcut, component, app }
}

test('create option restores picker selection, starts a copied preview and focuses the name', async (t) => {
  const ui = mountSettings(t)
  const original = structuredClone(getBuiltInThemes(false)[0])
  await ui.choose('__create__')
  assert.equal(ui.byId('appearance-theme-picker').value, original.id)
  assert.deepEqual(ui.events.select, [])
  assert.match(ui.state.preview.id, /^custom:/)
  assert.equal(ui.state.preview.name, '')
  assert.deepEqual(ui.state.preview.colors, original.colors)
  assert.equal(document.activeElement, ui.byId('theme-name'))
  assert.equal(ui.byId('theme-name').selected, true)
  assert.equal(ui.button('保存主题').props.disabled, true)
  await ui.click('取消')
  assert.equal(ui.state.preview, null)
  assert.deepEqual(ui.state.activeTheme, original)
  assert.equal(document.activeElement, ui.byId('appearance-theme-picker'))
  assert.deepEqual(ui.events.save, [])
})

test('valid backgrounds preview companion text and toolbar, but preserve explicit overrides', async (t) => {
  const ui = mountSettings(t)
  await ui.choose('__create__')
  await ui.input('theme-navigationBackground', '000000')
  await ui.input('theme-editorBackground', '#0000ff')
  await ui.input('theme-popupBackground', '111111')
  assert.equal(ui.state.preview.colors.navigationText, '#FFFFFF')
  assert.equal(ui.state.preview.colors.editorText, '#FFFFFF')
  assert.equal(ui.state.preview.colors.popupText, '#FFFFFF')
  assert.equal(ui.state.preview.colors.editorToolbarBackground, '#0000FF')
  await ui.click('展开详细颜色')
  assert.equal(ui.button('收起详细颜色').props['aria-expanded'], true)
  await ui.input('theme-navigationText', 'abc123')
  await ui.input('theme-editorText', 'ab1234')
  await ui.input('theme-editorToolbarBackground', '123456')
  await ui.input('theme-popupText', '#654321')
  await ui.input('theme-navigationBackground', 'ffffff')
  await ui.input('theme-editorBackground', '#ffffff')
  await ui.input('theme-popupBackground', 'ffffff')
  assert.equal(ui.state.preview.colors.navigationText, '#ABC123')
  assert.equal(ui.state.preview.colors.editorText, '#AB1234')
  assert.equal(ui.state.preview.colors.editorToolbarBackground, '#123456')
  assert.equal(ui.state.preview.colors.popupText, '#654321')
  assert.equal(ui.state.activeTheme.colors.editorText, '#172033')
  await ui.click('取消')
  await ui.choose('__create__')
  await ui.input('theme-editorBackground', '000000')
  assert.equal(ui.state.preview.colors.editorText, '#FFFFFF')
})

test('partial or invalid hex cannot save stale colors via submit or Ctrl+S', async (t) => {
  const ui = mountSettings(t)
  await ui.choose('__create__')
  await ui.input('theme-name', '测试主题')
  await ui.input('theme-editorBackground', '#aabbcc')
  const validPreview = ui.events.preview.at(-1)
  for (const invalid of ['#abc', 'gg1122', '']) {
    await ui.input('theme-editorBackground', invalid)
    assert.equal(ui.byId('theme-editorBackground').props['aria-invalid'], true)
    assert.equal(ui.button('保存主题').props.disabled, true)
    assert.equal(ui.events.preview.at(-1), validPreview)
    await ui.submit()
    const { event, handled } = await ui.shortcut('s', true)
    assert.equal(handled, true)
    assert.equal(event.prevented, true)
    assert.equal(event.stopped, true)
    assert.deepEqual(ui.events.save, [])
    assert.equal(ui.state.noteCommands, 0)
  }
  const colorPicker = ui.all().find((node) => node.tag === 'input' && node.props['aria-label'] === '正文背景颜色选择器')
  assert.equal(colorPicker.value, '#AABBCC')
  colorPicker.value = '#000000'
  colorPicker.dispatch('input')
  await nextTick()
  assert.equal(ui.byId('theme-editorBackground').props['aria-invalid'], false)
  assert.equal(ui.button('保存主题').props.disabled, false)
  assert.equal(ui.state.preview.colors.editorBackground, '#000000')
})

test('empty, long and duplicate trimmed names block save, including existing custom names', async (t) => {
  const customTheme = { id: 'custom:existing', name: 'Existing', colors: getBuiltInThemes(false)[0].colors }
  const ui = mountSettings(t, { customThemes: [customTheme] })
  await ui.choose('__create__')
  for (const name of [' ', 'x'.repeat(41), '  蓝底  ', ' eXiStInG ']) {
    await ui.input('theme-name', name)
    assert.equal(ui.byId('theme-name').props['aria-invalid'], true)
    assert.equal(ui.button('保存主题').props.disabled, true)
    await ui.submit()
    assert.deepEqual(ui.events.save, [])
  }
  await ui.input('theme-name', 'x'.repeat(40))
  assert.equal(ui.button('保存主题').props.disabled, false)
})

test('save emits every normalized color and the parent selects the saved theme', async (t) => {
  const ui = mountSettings(t)
  await ui.choose('__create__')
  await ui.input('theme-name', '  海边  ')
  await ui.input('theme-editorBackground', ' aBc123 ')
  await ui.input('theme-textHighlightColor', 'abcdef')
  await ui.input('theme-findHighlightColor', '#fedcba')
  await ui.submit()
  assert.equal(ui.events.save.length, 1)
  const saved = ui.events.save[0]
  assert.match(saved.id, /^custom:/)
  assert.equal(saved.name, '海边')
  assert.deepEqual(Object.keys(saved.colors).sort(), [...themeColorKeys].sort())
  for (const color of Object.values(saved.colors)) assert.match(color, /^#[0-9A-F]{6}$/)
  assert.equal(saved.colors.editorBackground, '#ABC123')
  assert.equal(saved.colors.textHighlightColor, '#ABCDEF')
  assert.equal(saved.colors.findHighlightColor, '#FEDCBA')
  assert.equal(ui.state.preview, null)
  assert.equal(ui.state.activeTheme.id, saved.id)
  assert.equal(ui.state.customThemes.length, 1)
  assert.equal(ui.byId('appearance-theme-picker').value, saved.id)
  assert.equal(ui.all().some((node) => node.tag === 'form'), false)
})

test('copy and edit keep stored colors independent; editing preserves identity and its own name', async (t) => {
  const source = { id: 'custom:source', name: '夜间', colors: getBuiltInThemes(true)[0].colors }
  const original = structuredClone(source)
  const existingCopy = { id: 'custom:copy', name: '夜间 副本', colors: { ...source.colors } }
  const ui = mountSettings(t, { activeTheme: source, customThemes: [source, existingCopy] })
  await ui.click('复制')
  assert.equal(ui.byId('theme-name').value, '夜间 副本 2')
  assert.notEqual(ui.state.preview.id, source.id)
  await ui.input('theme-editorBackground', 'ffffff')
  assert.deepEqual(source, original)
  await ui.click('取消')
  await ui.click('编辑')
  assert.equal(ui.state.preview.id, source.id)
  assert.equal(ui.byId('theme-name').value, source.name)
  assert.equal(ui.button('保存主题').props.disabled, false)
  await ui.input('theme-editorBackground', '#ffffff')
  assert.deepEqual(source, original)
  await ui.submit()
  assert.equal(ui.events.save[0].id, source.id)
  assert.equal(ui.state.customThemes.length, 2)
  assert.equal(ui.state.activeTheme.colors.editorBackground, '#FFFFFF')
  assert.deepEqual(source, original)
})

test('built-ins allow copies, while selecting an existing theme emits its id', async (t) => {
  const ui = mountSettings(t, { systemDark: true, activeTheme: getBuiltInThemes(true)[0] })
  assert.equal(ui.button('编辑').props.disabled, true)
  assert.equal(ui.button('删除').props.disabled, true)
  await ui.click('复制')
  assert.deepEqual(ui.state.preview.colors, getBuiltInThemes(true)[0].colors)
  await ui.click('取消')
  await ui.choose('black')
  assert.deepEqual(ui.events.select, ['black'])
  assert.equal(ui.state.activeTheme.id, 'black')
})

test('Escape, close, backdrop and unmount discard preview without modifying the active theme', async (t) => {
  const ui = mountSettings(t)
  const original = structuredClone(getBuiltInThemes(false)[0])
  for (const close of ['escape', 'close', 'backdrop']) {
    await ui.choose('__create__')
    await ui.input('theme-editorBackground', '000000')
    if (close === 'escape') {
      const { event, handled } = await ui.shortcut('Escape')
      assert.equal(handled, true)
      assert.equal(event.prevented, true)
      assert.equal(event.stopped, true)
    } else if (close === 'close') {
      ui.all().find((node) => node.props['aria-label'] === '关闭主题编辑').dispatch('click')
    } else {
      ui.all().find((node) => node.props.class === 'modal-backdrop theme-editor-backdrop').dispatch('click')
    }
    await nextTick()
    assert.equal(ui.state.preview, null)
    assert.deepEqual(ui.state.activeTheme, original)
    assert.deepEqual(ui.events.save, [])
  }
  await ui.choose('__create__')
  ui.app.unmount()
  assert.equal(ui.state.preview, null)
  assert.deepEqual(ui.state.activeTheme, original)
})

test('modal shortcuts consume note commands, and valid Ctrl+S saves once then returns control', async (t) => {
  const ui = mountSettings(t)
  await ui.choose('__create__')
  assert.equal((await ui.shortcut('n', true)).handled, true)
  assert.equal(ui.state.noteCommands, 0)
  await ui.input('theme-name', '快捷保存')
  const { event } = await ui.shortcut('S', true)
  assert.equal(event.prevented, true)
  assert.equal(event.stopped, true)
  assert.equal(ui.events.save.length, 1)
  assert.equal(ui.state.noteCommands, 0)
  assert.equal((await ui.shortcut('s', true)).handled, false)
  assert.equal(ui.state.noteCommands, 1)
})

test('deletion requires confirmation; cancel and Escape emit nothing and Ctrl+S cannot delete', async (t) => {
  const customTheme = { id: 'custom:delete', name: '待删除', colors: getBuiltInThemes(false)[0].colors }
  const ui = mountSettings(t, { activeTheme: customTheme, customThemes: [customTheme] })
  await ui.click('删除')
  assert.deepEqual(ui.events.delete, [])
  await ui.shortcut('s', true)
  assert.deepEqual(ui.events.delete, [])
  assert.deepEqual(ui.events.save, [])
  assert.equal(ui.state.noteCommands, 0)
  await ui.click('取消')
  assert.deepEqual(ui.events.delete, [])
  await ui.click('删除')
  await ui.shortcut('Escape')
  assert.deepEqual(ui.events.delete, [])
  await ui.click('删除')
  await ui.click('删除主题')
  assert.deepEqual(ui.events.delete, [customTheme.id])
  assert.equal(ui.all().some((node) => node.props['aria-labelledby'] === 'theme-delete-title'), false)
})

test('failed persistence retains every draft input and preview until a successful retry', async (t) => {
  const attempts = []
  let canPersist = false
  const ui = mountSettings(t, { saveTheme: (theme) => { attempts.push(theme); return canPersist } })
  await ui.choose('__create__')
  await ui.input('theme-name', '  保留修改  ')
  await ui.click('展开详细颜色')
  for (const key of themeColorKeys) await ui.input(`theme-${key}`, 'aBc123')
  const previewId = ui.state.preview.id
  await ui.submit()
  assert.equal(attempts.length, 1)
  assert.deepEqual(ui.events.save, [])
  assert.equal(ui.state.activeTheme.id, 'blue')
  assert.equal(ui.state.customThemes.length, 0)
  assert.equal(ui.state.preview.id, previewId)
  assert.equal(ui.byId('theme-name').value, '  保留修改  ')
  for (const key of themeColorKeys) assert.equal(ui.byId(`theme-${key}`).value, 'aBc123')
  assert.ok(ui.all().some((node) => node.props.role === 'alert' && /保存失败/.test(node.textContent)))
  canPersist = true
  await ui.shortcut('s', true)
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[1], attempts[0])
  assert.equal(ui.events.save.length, 1)
  assert.equal(ui.state.activeTheme.id, previewId)
  assert.equal(ui.state.preview, null)
  assert.equal(ui.all().some((node) => node.tag === 'form'), false)
})

test('failed deletion retains confirmation and active theme until retry succeeds', async (t) => {
  const source = { id: 'custom:keep', name: '保留主题', colors: getBuiltInThemes(false)[0].colors }
  const attempts = []
  let canPersist = false
  const ui = mountSettings(t, {
    activeTheme: source, customThemes: [source],
    deleteTheme: (id) => { attempts.push(id); return canPersist },
  })
  await ui.click('删除')
  await ui.click('删除主题')
  assert.deepEqual(attempts, [source.id])
  assert.deepEqual(ui.events.delete, [])
  assert.equal(ui.state.activeTheme.id, source.id)
  assert.ok(ui.all().some((node) => node.props.role === 'alert' && /删除失败/.test(node.textContent)))
  canPersist = true
  await ui.click('删除主题')
  assert.deepEqual(attempts, [source.id, source.id])
  assert.deepEqual(ui.events.delete, [source.id])
  assert.equal(ui.all().some((node) => node.props['aria-labelledby'] === 'theme-delete-title'), false)
})

test('rejected parent selection restores the picker, and plugin exit clears a preview draft', async (t) => {
  const ui = mountSettings(t, { acceptSelection: false })
  await ui.choose('black')
  assert.deepEqual(ui.events.select, ['black'])
  assert.equal(ui.state.activeTheme.id, 'blue')
  assert.equal(ui.byId('appearance-theme-picker').value, 'blue')
  await ui.choose('__create__')
  await ui.input('theme-editorBackground', '000000')
  assert.equal(ui.state.preview.colors.editorBackground, '#000000')
  ui.component.value.cancelPreview()
  await nextTick()
  assert.equal(ui.state.preview, null)
  assert.equal(ui.state.activeTheme.id, 'blue')
  assert.deepEqual(ui.events.save, [])
  assert.equal(ui.all().some((node) => node.tag === 'form'), false)
})
