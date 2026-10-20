/*
 * 悬浮球控制通道测试（拖不动 / 双击没反应 的根因锁）。
 *
 * 逆自当前 ZTools app.asar 的事实：
 *  - 宿主**没有**把 sendToParent 暴露给插件渲染层（只有主进程内部用），
 *    子窗口→主窗口实际只有 ipcRenderer.sendTo(hostId) 一条路；
 *  - hostId 陈旧（主窗口重载/重建）或主窗口句柄丢失（拖动的 wcId 守卫）→ 拖动+双击全死。
 *
 * 修复与断言：
 *  1) 拖动起手不再等 ack —— 无任何宿主应答时，第一条 move 消息也必须在80毫秒内发出
 *     （主窗口侧有 pendingDragMove/end 缓冲可以接住乱序）；
 *  2) 入站自愈 —— 收到任意主窗口消息即刷新 hostId（下一条出站消息用新 id）；
 *  3) ping→pong —— 主窗口必须应答子窗口存活探测；
 *  4) 球每5秒发一次 ping（行为验证）+ 45秒无回音自报 needsRestart（静态锁）；
 *  5) 句柄补偿/守望进程重建（静态锁）。
 *
 *   node tests/test-ball-channel.js
 */
'use strict';
const assert = require('assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const PLUGIN_DIR = path.join(__dirname, '..');
const CH = 'sb:cmd';

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push(label); console.log('  ✗ ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------------- 桩：断网 ---------------- */
const market = require(path.join(PLUGIN_DIR, 'lib', 'market.js'));
market.quotes = async () => [];
market.quotesTencent = market.quotes;
market.indexes = async () => [];
market.trend = async () => ({ items: [] });
market.detail = async () => ({});
market.search = async () => [];

const storeReal = require(path.join(PLUGIN_DIR, 'lib', 'store.js'));
const storeShim = Object.assign({}, storeReal, { createStore: (db) => storeReal.createStore(db, { isolated: true }) });

/* ---------------- 球窗口上下文（带出站/入站间谍） ---------------- */
const dbMap = new Map();
const sendToCalls = [];    // 子 → 宿主：要求 hostId 已知
const parentCalls = [];    // 子 → 父：Z.sendToParent 兜底路径

function makeBallCtx(api) {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const handlers = [];
  const ipc = {
    on: (ch, fn) => { if (ch === CH) handlers.push(fn); },
    sendTo: (id, ch, msg) => { if (ch === CH) sendToCalls.push({ id, msg }); },
    send: () => {}
  };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
      setItem: (k, v) => dbMap.set(k, v),
      removeItem: (k) => dbMap.delete(k)
    },
    sendToParent: (ch, msg) => { if (ch === CH) parentCalls.push({ msg }); },
    getWebContentsId: () => 12,
    showNotification() {}, isWindows: () => true,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    outPlugin() {}, hideMainWindow() {},
    createBrowserWindow: () => null, onPluginEnter() {}, onPluginOut() {}
  };
  Object.assign(ztools, api || {});
  const sandbox = {
    window: win, ztools, utools: ztools,
    location: { href: 'file:///plugin/windows/ball.html', pathname: '/windows/ball.html' },
    process: { argv: [], platform: 'win32' },
    console,
    require: (rid) => {
      if (rid === 'electron') return { ipcRenderer: ipc };
      if (/lib[\\/]store\.js$/.test(rid)) return storeShim;
      if (rid.charAt(0) === '.') return require(path.resolve(PLUGIN_DIR, rid));
      return require(rid);
    },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    TextDecoder, URL, Buffer, CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'preload.js' });
  return { services: win.services, handlers };
}

/* 主窗口上下文（验证 ping→pong 应答端） */
const mainSendTo = [];
function makeMainCtx() {
  const src = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const handlers = [];
  const ipc = {
    on: (ch, fn) => { if (ch === CH) handlers.push(fn); },
    sendTo: (id, ch, msg) => { if (ch === CH) mainSendTo.push({ id, msg }); },
    send: () => {}
  };
  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
  const ztools = {
    dbStorage: {
      getItem: (k) => (dbMap.has(k) ? dbMap.get(k) : null),
      setItem: (k, v) => dbMap.set(k, v),
      removeItem: (k) => dbMap.delete(k)
    },
    getWebContentsId: () => 11,
    showNotification() {}, isWindows: () => true,
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }),
    sendToParent: () => {}, outPlugin() {}, hideMainWindow() {},
    createBrowserWindow: () => null, onPluginEnter() {}, onPluginOut() {}
  };
  const sandbox = {
    window: win, ztools, utools: ztools,
    location: { href: 'file:///plugin/index.html', pathname: '/index.html' },
    process: { argv: [], platform: 'win32' },
    console,
    require: (rid) => {
      if (rid === 'electron') return { ipcRenderer: ipc };
      if (/lib[\\/]store\.js$/.test(rid)) return storeShim;
      if (rid.charAt(0) === '.') return require(path.resolve(PLUGIN_DIR, rid));
      return require(rid);
    },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    TextDecoder, URL, Buffer, CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'preload.js' });
  return { services: win.services, handlers };
}

/* ---------------- 球页面 DOM + ball.js（驱动真实拖动） ---------------- */
function mkEl(id) {
  const listeners = {};
  const el = {
    id, hidden: false, textContent: '', _html: '',
    style: { setProperty() {}, getPropertyValue() { return ''; }, removeProperty() {} },
    _cls: new Set(), scrollWidth: 0, scrollHeight: 0, offsetWidth: 0, offsetHeight: 0,
    addEventListener(t, fn) { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    fire(t, ev) {
      const e = Object.assign({ type: t, target: el, preventDefault() {}, stopPropagation() {} }, ev || {});
      (listeners[t] || []).slice().forEach((fn) => fn(e));
      return e;
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); }
  };
  Object.defineProperty(el, 'className', {
    get() { return Array.from(el._cls).join(' '); },
    set(v) { el._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  });
  el.classList = {
    add(c) { el._cls.add(c); }, remove(c) { el._cls.delete(c); }, contains(c) { return el._cls.has(c); },
    toggle(c, force) { if (force === undefined ? !el._cls.has(c) : force) el._cls.add(c); else el._cls.delete(c); }
  };
  return el;
}

function runBallPage(services) {
  const windowEvents = mkEl('window');
  const html = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.html'), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const registry = new Map();
  ids.forEach((id) => registry.set(id, mkEl(id)));
  const document = {
    readyState: 'complete', documentElement: mkEl('html'), hidden: false,
    getElementById: (id) => registry.get(id) || null,
    addEventListener() {}, removeEventListener() {}
  };
  const win = {
    services, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    devicePixelRatio: 1, innerWidth: 84, innerHeight: 84,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener: (t, fn) => windowEvents.addEventListener(t, fn), removeEventListener() {}, dispatchEvent() {}
  };
  const sandbox = {
    window: win, self: win, document,
    location: { href: 'file:///plugin/windows/ball.html', pathname: '/windows/ball.html', search: '' },
    navigator: { userAgent: 'node-test', language: 'zh-CN', platform: 'Win32' },
    process: { argv: [], platform: 'win32' },
    console,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval, queueMicrotask,
    Promise, Object, Array, Math, Date, JSON, String, Number, Boolean, Error, Map, Set, RegExp, isFinite, parseInt, parseFloat,
    Intl, TextDecoder, URL, Buffer,
    CustomEvent: class { constructor(t, o) { this.type = t; this.data = o; } },
    getComputedStyle: win.getComputedStyle,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    MutationObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  let err = null;
  try {
    vm.runInContext(fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.js'), 'utf8'), sandbox, { filename: 'ball.js' });
  } catch (e) { err = e; }
  return { err, registry, windowEvents };
}

(async () => {
  const t0 = Date.now();
  const ball = makeBallCtx();
  await sleep(30);
  const page = runBallPage(ball.services);
  ok(!page.err, 'ball.js 启动不抛异常', page.err && page.err.message);

  console.log('== 1. 起手不等 ack：无宿主应答也要在80ms内发出 move（旧实现卡400ms） ==');
  const ballEl = page.registry.get('ball');
  ballEl.fire('pointerdown', { button: 0, screenX: 100, screenY: 100, pointerId: 1 });
  ballEl.fire('pointermove', { pointerId: 1, screenX: 160, screenY: 160 });
  await sleep(80);
  const earlyMove = parentCalls.find((p) => p.msg && p.msg.t === 'drag' && p.msg.phase === 'move');
  const earlyStart = parentCalls.find((p) => p.msg && p.msg.t === 'drag' && p.msg.phase === 'start');
  ok(!!earlyStart, '起手消息已发出', parentCalls.map((p) => p.msg && p.msg.phase));
  ok(!!earlyMove, '80ms 内已发出 move —— 不等 ack（旧实现此时只有 start，move 要等400ms超时）',
    parentCalls.map((p) => p.msg && p.msg.phase));
  ballEl.fire('pointerup', { pointerId: 1, button: 0, screenX: 160, screenY: 160 });
  await sleep(20);

  console.log('== 2. 入站自愈：收到主窗口消息即刷新 hostId ==');
  ok(sendToCalls.length === 0, '此前 hostId 未知，出站只走了兜底路径（sendTo 未被调用）', sendToCalls.length);
  ball.handlers.forEach((fn) => fn({ senderId: 77 }, { t: 'pong' })); // 模拟主窗口发来消息
  ball.services.host.drag('move', 9, 9);
  await sleep(20);
  const healed = sendToCalls.find((c) => c.id === 77 && c.msg && c.msg.t === 'drag');
  ok(!!healed, '入站消息后 hostId 已更新为77，出站 sendTo(77) 生效', sendToCalls.map((c) => c.id));

  console.log('== 3. 主窗口必须应答 ping（存活探测的回音） ==');
  const main = makeMainCtx();
  await sleep(20);
  main.handlers.forEach((fn) => fn({ senderId: 55 }, { t: 'ping' }));
  await sleep(20);
  const pong = mainSendTo.find((c) => c.id === 55 && c.msg && c.msg.t === 'pong');
  ok(!!pong, '主窗口收到 ping 后回了 pong', mainSendTo.map((c) => c.msg && c.msg.t));

  console.log('== 4. 球每5秒发 ping（行为） ==');
  const wait = Math.max(0, 5400 - (Date.now() - t0));
  await sleep(wait);
  const pingOut = sendToCalls.find((c) => c.msg && c.msg.t === 'ping');
  ok(!!pingOut, '心跳定时器向主窗口发出了 ping', sendToCalls.map((c) => c.msg && c.msg.t));

  console.log('== 5. 自愈机制静态锁 ==');
  const pre = fs.readFileSync(path.join(PLUGIN_DIR, 'preload.js'), 'utf8');
  const bal = fs.readFileSync(path.join(PLUGIN_DIR, 'windows', 'ball.js'), 'utf8');
  ok(pre.includes("case 'ping'"), '主窗口 ping 应答分支在位');
  ok(pre.includes('lastHostMsgAt') && pre.includes('> 45000'), '球侧45秒无回音检测在位');
  ok(pre.includes('needsRestart') && pre.includes('悬浮球连接中断'), '断线自报 needsRestart + 用户通知');
  ok(pre.includes('needsRestart: false') && pre.includes('openBall(true)'), '守望进程1秒内消费标志并重建球');
  ok(pre.includes('句柄补偿') && pre.includes("t: 'die'"), '主窗口重载后句柄补偿（旧球自毁+重建）');
  ok(pre.includes("if (ROLE !== 'main' && senderId)"), '入站 hostId 刷新逻辑在位');
  ok(!bal.includes('ready 之前不发'), 'ball.js 不再有「等 ack 才发 move」的门控');
  ok(bal.includes('立即开火'), 'ball.js 起手即发注释在位');

  console.log('== 6. 失联时直接唤起：先等待窗口显示，再跳转 ==');
  const opened = [];
  let finishShow;
  const orphan = makeBallCtx({
    sendToParent: undefined,
    showMainWindow: () => { opened.push('show'); return new Promise((resolve) => { finishShow = resolve; }); },
    redirect: (cmd) => { opened.push(cmd); return true; }
  });
  const opening = orphan.services.host.openPlugin('stock');
  await sleep(750);
  ok(opened.join(',') === 'show', '主窗口无响应时调用宿主 API，显示完成前不跳转', opened);
  if (finishShow) finishShow();
  await opening;
  ok(opened.join(',') === 'show,stock', '显示完成后直接进入 stock 插件', opened);
  const replayBefore = sendToCalls.filter((c) => c.msg.t === 'open-plugin').length;
  orphan.handlers.forEach((fn) => fn({ senderId: 88 }, { t: 'hello' }));
  ok(sendToCalls.filter((c) => c.msg.t === 'open-plugin').length === replayBefore, '连接恢复后不重放已超时的打开请求');
  let rejectedRequest;
  let fallbackCalls = 0;
  const rejected = makeBallCtx({
    sendToParent: (ch, msg) => { rejectedRequest = msg; },
    showMainWindow: async () => {},
    redirect: () => { fallbackCalls++; return true; }
  });
  const rejectedOpen = rejected.services.host.openPlugin('stock');
  rejected.handlers.forEach((fn) => fn({ senderId: 89 }, { t: 'ack', for: rejectedRequest.mid, ok: false }));
  await rejectedOpen;
  ok(fallbackCalls === 1, '主窗口明确返回失败时也执行直接唤起');

  console.log('== 7. 捕获丢失和取消不能被当作双击 ==');
  const messages = [];
  let opens = 0;
  const interaction = runBallPage({ host: {
    drag: (...args) => messages.push(args),
    openPlugin: () => { opens++; }
  } });
  const el = interaction.registry.get('ball');
  const pointer = (x, y, id = 1) => ({ button: 0, pointerId: id, screenX: x, screenY: y });
  el.fire('pointerdown', pointer(100, 100));
  el.fire('pointerup', pointer(100, 100));
  el.fire('pointerdown', pointer(100, 100));
  el.fire('pointercancel', pointer(100, 100));
  ok(opens === 0, '取消事件不计作第二次单击');
  el.fire('pointerdown', pointer(100, 100));
  interaction.windowEvents.fire('pointermove', pointer(150, 140));
  el.fire('pointerup', pointer(150, 140, 2));
  ok(el.classList.contains('dragging'), '其他指针的松手不结束当前拖动');
  interaction.windowEvents.fire('pointerup', pointer(160, 150));
  ok(!el.classList.contains('dragging'), '球外松手可清理拖动状态');
  const end = messages.find((m) => m[0] === 'end');
  ok(end && end[1] === 60 && end[2] === 50, '最后一帧尚未执行也保留松手终点', end);
  el.fire('dblclick');
  ok(opens === 0, '拖动结束后的浏览器 dblclick 不会误开插件');
  el.fire('pointerdown', pointer(100, 100));
  el.fire('lostpointercapture', pointer(100, 100));
  ok(!el.classList.contains('dragging'), '丢失捕获可恢复交互');
  el.fire('pointerdown', pointer(100, 100));
  interaction.windowEvents.fire('blur');
  ok(!el.classList.contains('dragging'), '窗口失焦可恢复交互');
  await sleep(460);
  el.fire('pointerdown', pointer(100, 100));
  el.fire('pointerup', pointer(100, 100));
  el.fire('pointerdown', pointer(100, 100));
  el.fire('pointerup', pointer(100, 100));
  el.fire('dblclick');
  ok(opens === 1, '恢复后双击仍可打开插件，原生与手动检测只打开一次', opens);

  console.log('');
  if (fail === 0) {
    console.log('✓ 悬浮球控制通道测试全部通过（' + pass + ' 项）');
    process.exit(0);
  }
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项：');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
})().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
