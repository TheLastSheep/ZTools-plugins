/** 刷新更新状态的回归测试，不联网、不修改本机 Scoop。node tests/status_tests.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { EventEmitter } = require('events');

function mockScoop(responses) {
  const commands = [];
  const sandbox = {
    window: {}, module: { exports: {} }, console, Buffer, setTimeout, clearTimeout,
    process: { env: {}, on() {} },
    require(name) {
      if (name !== 'child_process') return require(name);
      return { spawn(exe, args) {
        commands.push(args[args.length - 1]);
        const response = responses.shift();
        assert.ok(response, '不应产生额外的 Scoop 命令');
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = () => {};
        queueMicrotask(() => {
          if (response.out) child.stdout.emit('data', Buffer.from(response.out));
          if (response.err) child.stderr.emit('data', Buffer.from(response.err));
          child.emit('close', response.code || 0);
        });
        return child;
      } };
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8'), sandbox);
  return { services: sandbox.module.exports, commands };
}

const row = (name, installed = '1.0', latest = '2.0', info = '', missing = '') => ({
  Name: name, 'Installed Version': installed, 'Latest Version': latest, Info: info, 'Missing Dependencies': missing
});
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('单个可更新项的 JSON 对象不能丢失', async () => {
  const { services } = mockScoop([{ out: JSON.stringify(row('git')) }]);
  const result = await services.status();
  assert.strictEqual(result.outdated.length, 1);
  assert.strictEqual(result.outdated[0].name, 'git');
  assert.strictEqual(result.outdated[0].latest, '2.0');
});

test('单个异常项也能识别', async () => {
  const { services } = mockScoop([{ out: JSON.stringify(row('old-app', '1.0', '', 'Manifest removed')) }]);
  const result = await services.status();
  assert.strictEqual(result.outdated.length, 0);
  assert.strictEqual(result.broken[0].name, 'old-app');
});

test('完全重复的行去重，同名不同版本或状态保留，锁定项仍显示', async () => {
  const rows = [row('git'), row('git'), row('git', '0.9'), row('git', '1.0', '2.0', 'Held package')];
  const { services } = mockScoop([{ out: JSON.stringify(rows) }]);
  const result = await services.status();
  assert.strictEqual(result.outdated.length, 3);
  assert.strictEqual(result.outdated[2].info, 'Held package');
});

test('弃用和缺少依赖但无新版本的包不计入可更新数', async () => {
  const { services } = mockScoop([{ out: JSON.stringify([
    row('deprecated', '1.0', '', 'Deprecated'), row('missing', '1.0', '', '', 'git | 7zip'), row('nvm')
  ]) }]);
  const result = await services.status();
  assert.strictEqual(result.outdated.length, 1);
  assert.strictEqual(result.broken.length, 2);
  assert.match(result.broken[1].info, /缺少依赖：git \| 7zip/);
});

test('全部最新的空输出和提示文本都支持', async () => {
  for (const out of ['', 'Everything is ok!\n']) {
    const { services } = mockScoop([{ out }]);
    const result = await services.status();
    assert.strictEqual(result.outdated.length, 0);
    assert.strictEqual(result.broken.length, 0);
  }
});

test('显式刷新先同步全部软件源，再读取本地状态，不执行软件升级', async () => {
  const { services, commands } = mockScoop([
    { out: 'Updating Buckets...\nScoop was updated successfully!\n' }, { out: JSON.stringify([row('git'), row('nvm')]) }
  ]);
  const logs = [];
  const result = await services.status({ refresh: true }, (line) => logs.push(line));
  assert.strictEqual(commands.length, 2);
  assert.match(commands[0], /scoop update 2>&1/);
  assert.match(commands[1], /scoop status --local \| ConvertTo-Json/);
  assert.strictEqual(result.outdated.length, 2);
  assert.strictEqual(result.syncFailed, false);
  assert.ok(logs.includes('Updating Buckets...'));
});

test('操作后重读状态不重复同步软件源', async () => {
  const { services, commands } = mockScoop([{ out: '' }]);
  await services.status();
  assert.strictEqual(commands.length, 1);
  assert.match(commands[0], /scoop status --local/);
});

test('更新日志中的 failed 字样不误判为软件源同步失败', async () => {
  const { services } = mockScoop([
    { out: 'main: abc123 Fix failed download detection\nScoop was updated successfully!' }, { out: '' }
  ]);
  assert.strictEqual((await services.status({ refresh: true })).syncFailed, false);
});

test('同步退出失败时保留本地结果并提示可能遗漏更新', async () => {
  const { services } = mockScoop([{ err: 'fatal: network unavailable', code: 1 }, { out: JSON.stringify(row('nvm')) }]);
  const result = await services.status({ refresh: true });
  assert.strictEqual(result.outdated.length, 1);
  assert.strictEqual(result.syncFailed, true);
  assert.match(result.warnings.join('\n'), /可能遗漏更新/);
});

test('Scoop 退出码为零但部分 bucket 拉取失败或跳过，也提示结果不完整', async () => {
  for (const out of ['fatal: unable to access bucket\nScoop was updated successfully!', "'extras' is not a git repository. Skipped.", 'WARN Update aborted.']) {
    const { services } = mockScoop([{ out }, { out: '' }]);
    const result = await services.status({ refresh: true });
    assert.strictEqual(result.syncFailed, true);
    assert.match(result.warnings[0], /软件源同步未完成/);
  }
});

test('状态命令失败、错误流包含异常或 JSON 损坏时不能伪装成空列表', async () => {
  for (const response of [
    { out: 'command failed', code: 1 },
    { out: JSON.stringify(row('git')), err: 'Access is denied' },
    { out: '[{"Name":"git"' }
  ]) {
    const { services } = mockScoop([response]);
    await assert.rejects(services.status());
  }
});

// 最小 DOM 桩运行真实 app.js，验证按钮事件、刷新互斥和提示的恢复。
function mockPage() {
  const elements = new Map();
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const buttonIds = new Set(Array.from(html.matchAll(/<button\b[^>]*\bid="([^"]+)"/g), (match) => match[1]));
  function element(selector) {
    if (elements.has(selector)) return elements.get(selector);
    const classes = new Set();
    const node = {
      textContent: '', innerHTML: '', hidden: false, disabled: false, value: '', dataset: {},
      classList: {
        add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c),
        toggle(c, value) { if (value) classes.add(c); else classes.delete(c); }
      },
      addEventListener() {}, appendChild() {},
      querySelector: (s) => element(selector + ' ' + s), closest: (s) => element(selector + ' ' + s),
      click() { if (this.onclick) return this.onclick(); }
    };
    elements.set(selector, node);
    return node;
  }
  const tabs = ['installed', 'status', 'bucket', 'cache', 'search'].map((tab) => {
    const node = element('.tab[data-tab="' + tab + '"]');
    node.dataset.tab = tab;
    return node;
  });
  const actions = Array.from(buttonIds, (id) => element('#' + id));
  const calls = [];
  let resolveStatus;
  const services = {
    theme: () => ({}), onThemeChange() {}, notify() {},
    detect: async () => ({ ok: true, version: '0.6.0', warnings: [] }),
    installed: async () => ({ apps: [], warnings: [] }),
    status(options) {
      calls.push(options);
      return new Promise((resolve) => { resolveStatus = resolve; });
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8'), {
    window: { services }, console, setTimeout, clearTimeout,
    document: {
      body: element('body'),
      querySelector: (s) => /^#btn-[\w-]+$/.test(s) && !buttonIds.has(s.slice(1)) ? null : element(s),
      createElement: () => element('new'), addEventListener() {},
      querySelectorAll: (s) => s === '.tab' ? tabs : s === '.pane' ? [] : actions
    }
  });
  return { element, calls, finish: (result) => resolveStatus(result) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('检查更新会同步；其他列表返回不能提前解锁；失败提示可恢复', async () => {
  const page = mockPage();
  await tick();
  const check = page.element('#btn-check-update');
  const pending = check.onclick();
  assert.strictEqual(page.calls[0].refresh, true);
  assert.strictEqual(check.disabled, true);
  page.element('.tab[data-tab="installed"]').onclick();
  await tick();
  assert.strictEqual(check.disabled, true, '已安装列表返回不能释放写锁');
  check.onclick();
  assert.strictEqual(page.calls.length, 1, '重复点击不能并发同步');
  page.finish({ outdated: [], broken: [], warnings: ['网络失败'], syncFailed: true });
  await pending;
  assert.strictEqual(check.disabled, false);
  assert.match(page.element('#pane-status .empty').textContent, /同步未完成/);
  const next = check.onclick();
  assert.strictEqual(page.calls[1].refresh, true);
  page.finish({ outdated: [], broken: [], warnings: [], syncFailed: false });
  await next;
  await tick();
  assert.strictEqual(page.element('#pane-status .empty').textContent, '暂无可更新项 🎉');
  assert.strictEqual(page.element('#status-warnings').hidden, true);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (e) { failed++; console.error('  ✗ ' + name + '\n' + e.stack); }
  }
  console.log('\n更新状态回归测试：' + (tests.length - failed) + '/' + tests.length + ' 通过');
  process.exitCode = failed ? 1 : 0;
})();
