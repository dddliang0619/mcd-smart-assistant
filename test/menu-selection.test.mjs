import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexMenu, livePreferences, preferredMealItem, verifyMealSelection, verifyPlanPreferences } from '../server/menu-selection.mjs';
import { ReadCache, mapLimit } from '../server/read-cache.mjs';
import { OrderingAgent } from '../server/agent.mjs';
import { OrderService } from '../server/domain.mjs';

const detail = () => ({ code: 'BUNDLE', name: '随心配', rounds: [
  { id: 1, quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [
    { code: 'BURGER', name: '麦辣鸡腿汉堡', quantity: 1, isDefault: 1 },
    { code: 'NUGGETS', name: '麦乐鸡5块', quantity: 0, isDefault: 0, maxQuantity: -1 }
  ] },
  { id: 2, quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [
    { code: 'WATER', name: '纯悦饮用水', quantity: 1, isDefault: 1 },
    { code: 'COKE', name: '可乐中杯', quantity: 0, isDefault: 0 },
    { code: 'ZERO', name: '无糖可口可乐中杯', quantity: 0, isDefault: 0 }
  ] }
] });

test('完整索引包含所有分类、未知名称套餐、会员价项目，不按三个固定套餐截断', () => {
  const menu = { categories: [{ name: '小食拼盘', meals: [{ code: 'OTHER', tags: ['套餐'] }] }], meals: { BUNDLE: { name: '随心配' }, OTHER: { name: '酥脆无双', canWithOrder: true }, BURGER: { name: '麦辣鸡腿汉堡' } } };
  const indexed = indexMenu(menu, livePreferences('只吃小吃'));
  assert.equal(indexed.count, 3);
  assert.equal(indexed.items.find(i => i.code === 'OTHER').needsCompositionCheck, true);
  assert.ok(indexed.items.some(i => i.code === 'BURGER'), '冲突名称仍可审计，不凭名字删除未知组合');
});

test('只吃小吃加可乐：从官方可选项替换汉堡和纯悦，普通与无糖不混淆', () => {
  for (const [text, code] of [['只想吃小吃，不想吃汉堡，想喝可乐，不喝纯悦', 'COKE'], ['只吃小食，饮料换无糖可乐', 'ZERO']]) {
    const prefs = livePreferences(text);
    const { item } = preferredMealItem(detail(), 'BUNDLE', 2, prefs);
    assert.equal(item.quantity, 2);
    assert.deepEqual(item.roundList[0].comboItemList, [{ code: 'NUGGETS', quantity: 1 }]);
    assert.deepEqual(item.roundList[1].comboItemList, [{ code, quantity: 1 }]);
    verifyPlanPreferences(verifyMealSelection(detail(), item, prefs), prefs);
  }
});

test('不可替换的汉堡或水不能通过改标题/增加一杯可乐蒙混，必选分组及假码拦截', () => {
  const prefs = livePreferences('不要汉堡，只吃小吃，要可乐');
  const bad = detail(); bad.rounds[0].choices = bad.rounds[0].choices.slice(0, 1);
  assert.throws(() => preferredMealItem(bad, 'BUNDLE', 1, prefs), /无法满足/);
  const good = preferredMealItem(detail(), 'BUNDLE', 1, prefs).item;
  const forged = structuredClone(good); forged.roundList[1].comboItemList[0].code = 'FAKE';
  assert.throws(() => verifyMealSelection(detail(), forged, prefs), /子项编码/);
  const missing = structuredClone(good); missing.roundList.pop();
  assert.throws(() => verifyMealSelection(detail(), missing, prefs), /分组/);
  const original = structuredClone(good); original.roundList[1].comboItemList[0].code = 'WATER';
  assert.throws(() => verifyMealSelection(detail(), original, prefs), /实际组成/);
  assert.throws(() => verifyPlanPreferences(['麦乐鸡', '纯悦'], prefs), /指定的可乐/);
  assert.throws(() => verifyPlanPreferences(['麦乐鸡', '可乐麦炫酷'], prefs), /指定的可乐/);
});

test('不要饮料时不强行配饮料；偏好冲突和仅饮料假小吃均拦截', () => {
  const prefs = livePreferences('只吃小吃，不要饮料');
  assert.throws(() => preferredMealItem(detail(), 'BUNDLE', 1, prefs), /无法满足/);
  const single = { code: 'FRIES', name: '薯条' };
  verifyPlanPreferences(verifyMealSelection(single, preferredMealItem(single, 'FRIES', 1, prefs).item, prefs), prefs);
  assert.throws(() => livePreferences('不要饮料，要可乐'), /冲突/);
  assert.throws(() => verifyPlanPreferences(['可乐'], livePreferences('只吃小吃，要可乐')), /真实小食/);
});

test('短时缓存按完整门店/取餐参数隔离并去重，价格和地址每次请求，过期重读', async () => {
  let now = 0, calls = 0;
  const cache = new ReadCache({ now: () => now, mcp: { call: async () => { calls++; return { value: calls }; } } });
  const metrics = { officialCalls: 0, cacheHits: 0 };
  const args = { storeCode: 'ONE', orderType: 1 };
  const values = await Promise.all([cache.call('query-meals', args, metrics), cache.call('query-meals', args, metrics)]);
  values[0].value = 99; assert.equal(values[1].value, 1); assert.equal(calls, 1);
  assert.equal((await cache.call('query-meals', args, metrics)).value, 1);
  await cache.call('query-meals', { ...args, storeCode: 'TWO' }, metrics);
  await cache.call('query-meals', { ...args, orderType: 2 }, metrics);
  assert.equal(calls, 3);
  now = 60001; await cache.call('query-meals', args, metrics); assert.equal(calls, 4);
  for (const name of ['calculate-price', 'delivery-query-addresses']) { await cache.call(name, args, metrics); await cache.call(name, args, metrics); }
  assert.equal(calls, 8); assert.equal(metrics.cacheHits, 2);
});

test('官方读取最多4路并行，失败释放槽位且错误不缓存', async () => {
  let active = 0, max = 0, calls = 0;
  const releases = [];
  const cache = new ReadCache({ mcp: { call: async () => { calls++; active++; max = Math.max(max, active); await new Promise(r => releases.push(r)); active--; return {}; } } });
  const pending = mapLimit(Array.from({ length: 9 }, (_, i) => i), i => cache.call('query-meals', { id: i }));
  while (calls < 9 || active) { await new Promise(r => setImmediate(r)); for (const resolve of releases.splice(0)) resolve(); }
  await pending; assert.equal(max, 4); assert.equal(cache.active, 0);
  let failures = 0; const broken = new ReadCache({ mcp: { call: async () => { failures++; throw new Error('fixture'); } } });
  await assert.rejects(broken.call('query-meals', {})); await assert.rejects(broken.call('query-meals', {}));
  assert.equal(failures, 2); assert.equal(broken.active, 0);
});

test('批量核价满足数量后直接展示，拦截不合偏好候选，复用菜单但重新核价', async () => {
  const schema = properties => ({ type: 'object', properties });
  const common = { storeCode: { type: 'string' }, beType: { type: 'integer' }, orderType: { type: 'integer' } };
  const tools = [ { name: 'query-nearby-stores', inputSchema: schema({}) }, { name: 'query-meals', inputSchema: schema(common) },
    { name: 'query-meal-detail', inputSchema: schema({ ...common, code: { type: 'string' } }) },
    { name: 'calculate-price', inputSchema: schema({ ...common, items: { type: 'array' } }) },
    { name: 'create-order', inputSchema: schema(common) } ];
  const calls = [];
  const mcp = { ready: async () => tools, call: async (name, args) => {
    calls.push(name);
    if (name === 'query-nearby-stores') return [{ storeCode: 'GZ', storeName: '广州测试门店' }];
    if (name === 'query-meals') return { meals: { BUNDLE: { name: '随心配' }, FIXED: { name: '固定汉堡套餐' }, EXTRA: { name: '薯条' }, DRINK: { name: '可乐' } } };
    if (name === 'query-meal-detail') {
      if (args.code === 'EXTRA') return { code: 'EXTRA', name: '薯条' };
      if (args.code === 'DRINK') return { code: 'DRINK', name: '可乐小杯' };
      const data = detail(); if (args.code === 'FIXED') { data.code = 'FIXED'; data.rounds[0].choices.pop(); } return data;
    }
    if (name === 'calculate-price') {
      if (args.items[0].productCode === 'EXTRA') {
        assert.deepEqual(args.items, [{ productCode: 'EXTRA', quantity: 1 }, { productCode: 'DRINK', quantity: 1 }]);
        return { price: 1500, productList: args.items.map(item => ({ ...item, productName: item.productCode, subtotal: 750 })), takeWayList: [{ code: 'TAKE', name: '外带' }] };
      }
      assert.deepEqual(args.items[0].roundList[0].comboItemList, [{ code: 'NUGGETS', quantity: 1 }]);
      assert.deepEqual(args.items[0].roundList[1].comboItemList, [{ code: 'COKE', quantity: 1 }]);
      return { price: 1800, productList: [{ productCode: 'BUNDLE', productName: '随心配', quantity: 1, subtotal: 1800 }], takeWayList: [{ code: 'TAKE', name: '外带' }] };
    }
    assert.fail('不允许下单');
  } };
  let round = 0;
  const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const base = { storeCode: 'GZ', beType: 1, orderType: 1 };
  const orders = new OrderService({ mode: 'live', mcp });
  const agent = new OrderingAgent({ mcp, orders, config: { aiBaseUrl: 'https://example.invalid', aiModel: 'test', aiKey: 'test' }, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body); let tool_calls;
    const step = round++ % 2;
    if (step === 0) tool_calls = [call('query-nearby-stores', {}, 'store'), call('query-meals', base, 'menu')];
    else if (step === 1) {
      assert.equal(JSON.parse(body.messages.find(m => m.tool_call_id === 'menu').content).count, 4);
      assert.deepEqual(body.tools.map(t => t.function.name), ['price_menu_candidates']);
      tool_calls = round <= 2 ? [call('price_menu_candidates', { ...base, candidates: ['BUNDLE', 'FIXED', 'EXTRA'].map(code => ({ title: code, items: [{ productCode: code, quantity: 1 }] })) }, 'batch')]
        : ['BUNDLE', 'FIXED', 'EXTRA'].map((productCode, i) => call('query-meal-detail', { ...base, productCode, quantity: 1 }, 'old-name' + i));
    }
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls } }] }) };
  } });
  const input = { text: '只吃小吃，不吃汉堡，想喝可乐，不要纯悦', context: { fulfillment: 'pickup', location: '广州', budget: 40, optionCount: 2 } };
  for (let i = 0; i < 2; i++) {
    const result = await agent.plan(input);
    assert.equal(result.quote.total, '15.00'); assert.match(result.quotes[1].note, /麦乐鸡5块.*可乐中杯/);
    assert.match(result.quote.note, /薯条.*可乐小杯/);
    assert.equal(result.menuCoverage.stores[0].menuItems, 4); assert.equal(result.menuCoverage.quotedCandidates, 2);
    assert.equal(result.performance.aiRounds, 2);
  }
  assert.equal(calls.filter(n => n === 'query-meals').length, 1);
  assert.equal(calls.filter(n => n === 'calculate-price').length, 4);
  assert.equal(orders.attempts.size, 0);
});
