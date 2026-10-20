'use strict';
/**
 * 交易费率的品种/市场判定测试（calculateFees）。
 *
 * 回归背景：isETF 只认 51/15 开头，588/56/50 开头的沪市基金被当成股票 ——
 * 卖出被错收万5印花税（场内基金实际免收）、佣金用股票费率、过户费按深市口径。
 * 另外 isShanghai 漏掉 56/58 段，沪市基金的过户费也算错。
 *
 *   node tests/test-fee-classification.js
 */
'use strict';
const assert = require('assert');
const { createStore } = require('../lib/store.js');

function makeStore() {
  const db = new Map();
  return createStore({
    getItem: (k) => (db.has(k) ? db.get(k) : null),
    setItem: (k, v) => db.set(k, v),
    removeItem: (k) => db.delete(k)
  }, { isolated: true });
}

function feesFor(code, type, price, qty) {
  return makeStore().calculateFees({ stock_code: code, type, price, quantity: qty });
}

function run() {
  console.log('== 1. 场内基金卖出：免印花税、按 ETF 佣金费率 ==');
  // 覆盖全部基金代码段：51（沪ETF老段）/15（深ETF）/56、58（沪ETF新段，曾被当股票）/50（沪LOF）/16（深LOF）
  ['510300', '588000', '561980', '501050', '159915', '160323'].forEach((code) => {
    const f = feesFor(code, 2, 1.0, 10000); // 卖出 1 元 × 1 万股 = 1 万元
    assert.strictEqual(f.stamp_tax, 0, code + ' 卖出印花税应为 0（基金免收）');
    assert.strictEqual(f.commission, 0.6, code + ' 佣金应按万0.6 计 0.6 元（' + f.commission + '）');
  });

  console.log('== 1.1 基金过户费按市场口径：沪市万0.1 / 深市默认 0 ==');
  assert.strictEqual(feesFor('588000', 2, 1.0, 10000).transfer_fee, 0.1, '沪市基金过户费 0.1 元');
  assert.strictEqual(feesFor('159915', 2, 1.0, 10000).transfer_fee, 0, '深市基金过户费默认 0');

  console.log('== 2. 股票卖出：仍收印花税、按股票佣金费率 ==');
  const stock = feesFor('600961', 2, 20.0, 1000); // 2 万元
  assert.strictEqual(stock.stamp_tax, 10, '600961 卖出印花税应为 10 元（2万×万5）');
  assert.strictEqual(stock.commission, 1.71, '600961 佣金应为 1.71 元（2万×万0.854）');
  const stockSz = feesFor('300547', 2, 20.0, 1000);
  assert.strictEqual(stockSz.transfer_fee, 0, '深市股票过户费默认为 0');

  console.log('== 3. 买入不收印花税 ==');
  const buy = feesFor('600961', 1, 20.0, 1000);
  assert.strictEqual(buy.stamp_tax, 0, '买入印花税应为 0');
  assert.strictEqual(Math.round(buy.total_price * 100), 2000191, '买入实付 = 金额 + 佣金 + 过户费 = 20001.91');

  console.log('== 4. 沪市 ETF 买入：过户费按沪市口径（旧实现算成深市 0） ==');
  const etfBuy = feesFor('588000', 1, 1.0, 10000);
  assert.strictEqual(etfBuy.transfer_fee, 0.1, '588000 买入过户费应为 0.1 元（沪市万0.1）');

  console.log('\n✓ 费率品种/市场判定测试全部通过');
}

run();
