'use strict';
/**
 * 交易流水 id 唯一性测试。
 *
 * 回归背景：importFromTransactionsJson / addTransaction 里
 * id = Date.now() + Math.floor(Math.random() * 1000)。
 * 导入是在同一个 .map() 里同步处理全部记录，Date.now() 基本同一毫秒，
 * 随机数只有 1000 个桶 —— 导入 50 条就有约七成概率产生重复 id，
 * 而 deleteTransaction 按 id 过滤，会把撞号的另一条一起删掉。
 * 现在改为「毫秒×1000 + 进程序号」，同一毫秒批量导入也不重复。
 *
 *   node tests/test-import-id-uniqueness.js
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('assert');
const { createStore } = require('../lib/store.js');

function run() {
  const db = new Map();
  const store = createStore({
    getItem: (k) => (db.has(k) ? db.get(k) : null),
    setItem: (k, v) => db.set(k, v),
    removeItem: (k) => db.delete(k)
  }, { isolated: true });

  // 120 条导入源（同一毫秒内 map 完，旧实现几乎必撞 id）
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-test-'));
  const src = path.join(dir, 'stock_transactions.json');
  const list = [];
  for (let i = 0; i < 120; i++) {
    list.push({
      stock_code: '600961',
      stock_name: '株冶集团',
      type: 1,
      price: 10,
      quantity: 100,
      created_at: new Date(Date.UTC(2026, 0, 1, 1, 0, i % 60)).toISOString()
    });
  }
  fs.writeFileSync(src, JSON.stringify(list), 'utf8');

  const res = store.importFromFile(src);
  assert.ok(res.ok, '导入应成功：' + JSON.stringify(res));
  const txs = store.getTransactions();
  assert.strictEqual(txs.length, 120, '应导入 120 条');
  const ids = new Set(txs.map((t) => String(t.id)));
  assert.strictEqual(ids.size, txs.length, 'id 不得重复（旧实现同毫秒批量导入高概率撞号）');

  console.log('== 1. 批量导入 120 条，id 全部唯一 ==');

  // 按 id 删除只应删掉一条
  const victim = txs[0].id;
  store.deleteTransaction(victim);
  assert.strictEqual(store.getTransactions().length, 119, '按 id 删除只应影响一条记录');
  console.log('== 2. 按 id 删除只删一条，不连环删 ==');

  // 单笔录入的 id 也不得与现有记录冲突
  const before = new Set(store.getTransactions().map((t) => String(t.id)));
  const added = store.addTransaction({ stock_code: '600961', stock_name: '株冶集团', type: 1, price: 10, quantity: 100 });
  assert.ok(!before.has(String(added.id)), '新交易 id 不得与已有 id 冲突');
  assert.strictEqual(store.getTransactions().length, 120, '录入后总数 120');
  console.log('== 3. 单笔录入 id 不与已有记录冲突 ==');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n✓ 导入流水 id 唯一性测试全部通过');
}

run();
