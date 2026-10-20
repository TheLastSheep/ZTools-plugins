/*
 * 价格精度测试 —— ETF/可转债/低价股是三位小数（1.057），截成两位会算错金额。
 *
 * 修复背景：数据层 store.js 早就 toFixed(3) 了，行情/持仓也一直走 fmtPrice（正确），
 *   但 6 处调用点漏了 —— 买卖录入回填价格、搜索选中回填、流水明细单价、
 *   预警弹窗最新价、预警通知文本 —— 全部硬编码 toFixed(2)。
 *
 * 口径（与 index.js / panel.js 的 fmtPrice 一致）：
 *   价格 < 10 元  → 3 位小数（ETF 1.057、可转债、仙股）
 *   价格 >= 10 元 → 2 位小数（普通 A 股）
 *   金额（成交额/手续费/实付）→ 永远是 2 位，那是钱，不能跟着变
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { console.log('  ✗ ' + msg + (extra !== undefined ? '  → ' + extra : '')); process.exitCode = 1; }
}

/* 行为验证：抽出真实 fmtPrice 跑一遍（不 mock，锁死数值口径） */
function extractFmtPrice(src, label) {
  const i = src.indexOf('function fmtPrice');
  assert.ok(i >= 0, label + ' 应有 fmtPrice');
  // 花括号配对取出完整函数
  let depth = 0, started = false, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) { end = k; break; } }
  }
  const fnSrc = src.slice(i, end + 1);
  // eslint-disable-next-line no-new-func
  return new Function(fnSrc + '; return fmtPrice;')();
}

console.log('== 1. 行为：价格精度口径（<10 三位，>=10 两位） ==');
for (const [file, label] of [['index.js', '主窗口'], ['windows/panel.js', '自选小窗']]) {
  const fmtPrice = extractFmtPrice(read(file), label);
  // 真实持仓数据：516010 游戏ETF 成交价 1.057
  assert.strictEqual(fmtPrice(1.057), '1.057', label + ' ETF 1.057 应保留三位');
  assert.strictEqual(fmtPrice(0.883), '0.883', label + ' 0.883 应保留三位');
  assert.strictEqual(fmtPrice(9.999), '9.999', label + ' 9.999 临界应三位');
  assert.strictEqual(fmtPrice(26.964), '26.96', label + ' 26.964 应显示两位');
  assert.strictEqual(fmtPrice(10), '10.00', label + ' 10 应显示两位');
  assert.strictEqual(fmtPrice(0), '0.000', label + ' 0 应显示三位');
  ok(true, label + ' 价格精度正确（ETF 三位 / 普通股两位）');
}

console.log('== 2. 行为：预警通知价格（preload.js 独立实现） ==');
{
  const src = read('preload.js');
  const i = src.indexOf('function fmtAlertPrice');
  assert.ok(i >= 0, 'preload.js 应有 fmtAlertPrice');
  let depth = 0, started = false, end = -1;
  for (let k = i; k < src.length; k++) {
    if (src[k] === '{') { depth++; started = true; }
    else if (src[k] === '}') { depth--; if (started && depth === 0) { end = k; break; } }
  }
  const f = new Function(src.slice(i, end + 1) + '; return fmtAlertPrice;')();
  assert.strictEqual(f(1.057), '1.057', '通知里 ETF 价格保留三位');
  assert.strictEqual(f(26.964), '26.96', '通知里普通股价格两位');
  assert.strictEqual(f(NaN), '--', '非法值显示 --');
  ok(true, '预警通知价格精度正确');
}

console.log('== 3. 静态断言：6 处调用点不得再用硬编码 toFixed(2) ==');
{
  // 价格类：必须走 fmtPrice
  const idx = read('index.js');
  const pan = read('windows/panel.js');
  const pre = read('preload.js');

  ok(idx.includes("fmtPrice(o.price)"), '主窗口·买卖弹窗回填价格走 fmtPrice');
  ok(idx.includes("'¥' + fmtPrice(t.price) + ' × '"), '主窗口·流水明细单价走 fmtPrice');
  ok(idx.includes("$('txPrice').value = fmtPrice(d.price)"), '主窗口·搜索选中回填走 fmtPrice');
  ok(pan.includes("fmtPrice(o.price)"), '小窗·买卖弹窗回填价格走 fmtPrice');
  ok(pan.includes("'¥' + fmtPrice(t.price) + ' × '"), '小窗·流水明细单价走 fmtPrice');
  ok(pan.includes("$('txPrice').value = fmtPrice(d.price)"), '小窗·搜索选中回填走 fmtPrice');
  ok(pre.includes("fmtAlertPrice(price)") && pre.includes("fmtAlertPrice(alert.high_price)"), '预警通知两分支都走 fmtAlertPrice');

  // 反向：价格类不得残留 toFixed(2)（total_price / 手续费 / 金额 允许）
  const badIdx = idx.split('\n').filter((l) => /\bprice\b/i.test(l) && /toFixed\(2\)/.test(l) && !/total_price/.test(l));
  const badPan = pan.split('\n').filter((l) => /\bprice\b/i.test(l) && /toFixed\(2\)/.test(l) && !/total_price/.test(l));
  ok(badIdx.length === 0, '主窗口无价格类 toFixed(2) 残留', badIdx.join(' | '));
  ok(badPan.length === 0, '小窗无价格类 toFixed(2) 残留', badPan.join(' | '));
}

console.log('== 4. 静态断言：金额类仍是 2 位（不能被误改成 3 位） ==');
{
  const idx = read('index.js');
  ok(idx.includes("feeRes.total_price.toFixed(2)"), '实付/实得金额仍 2 位');
  ok(idx.includes("Number(t.total_price || (t.price * t.quantity)).toFixed(2)"), '成交总额仍 2 位');
  const pan = read('windows/panel.js');
  ok(pan.includes("feeRes.total_price.toFixed(2)"), '小窗实付金额仍 2 位');
  // 成本均价本来就是 3 位
  ok(idx.includes('Number(currentCostPrice.toFixed(3))'), '成本均价保持 3 位');
}

console.log('== 5. 输入框精度：step 必须支持三位小数 ==');
{
  for (const [f, label] of [['index.html', '主窗口'], ['windows/panel.html', '小窗']]) {
    const html = read(f);
    const m = html.match(/<input id="txPrice"[^>]*>/);
    assert.ok(m, label + ' 有 txPrice 输入框');
    ok(/step="0\.001"/.test(m[0]), label + ' txPrice step=0.001（能录 1.057）', m[0]);
  }
}

console.log('\n✓ 价格精度测试全部通过（' + pass + ' 项）\n');
