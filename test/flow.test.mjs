// 演示模式下的完整流程自检：配餐 → 确认下单 → 重复确认。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.mjs';

const KEY = 'test-key-1234567890';
const CONTEXT = { fulfillment: 'pickup', location: '广州天河区', budget: 40 };

async function startServer(directory, options = {}) {
  const config = {
    mode: 'demo', accessKey: KEY, host: '127.0.0.1', port: 0,
    mcdToken: '', aiBaseUrl: 'https://example.invalid', aiModel: 'test', aiKey: '', ...options.config
  };
  const dir = directory || mkdtempSync(join(tmpdir(), 'mcd-test-'));
  const { server } = createApp({ config, directory: dir, mcp: options.mcp });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    directory: dir,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function call(base, path, body, key = KEY) {
  const options = {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
  };
  if (body !== undefined) options.body = JSON.stringify(body);
  const response = await fetch(base + path, options);
  return { status: response.status, body: await response.json() };
}

test('演示模式：配餐、下单、重复确认都返回同一份记录', async () => {
  const app = await startServer();
  try {
    const plan = await call(app.base, '/api/plan', { text: '一份汉堡套餐', context: CONTEXT });
    assert.equal(plan.status, 200);
    assert.ok(plan.body.quote, '演示模式应返回报价');
    const quote = plan.body.quote;
    assert.ok(Number(quote.total) <= 40);
    assert.equal(plan.body.quotes.length, 3);
    assert.equal(plan.body.catalog.productCount, 104);
    assert.equal(quote.priceBasis, 'simulated');
    assert.equal(quote.demo, true);
    assert.ok(quote.takeWays.length > 0, '自取方案应带回官方取餐方式选项');

    const first = await call(app.base, '/api/confirm', {
      quoteId: quote.id, takeWayCode: quote.takeWays[0].code, confirmed: true
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.status, 'created');
    assert.match(first.body.order.orderId, /^DEMO-/);

    // 用户重复点确认，必须拿到同一份记录，不能再创建订单。
    const second = await call(app.base, '/api/confirm', {
      quoteId: quote.id, takeWayCode: quote.takeWays[0].code, confirmed: true
    });
    assert.deepEqual(second.body.order, first.body.order);

    const list = await call(app.base, '/api/orders');
    assert.equal(list.body.orders.length, 1);
  } finally {
    await app.close();
  }
});

test('产品目录接口可分页读取全部104款147规格，且受口令保护', async () => {
  const app = await startServer();
  try {
    const first = await call(app.base, '/api/catalog?limit=60');
    const second = await call(app.base, '/api/catalog?limit=60&offset=60');
    const products = [...first.body.products, ...second.body.products];
    assert.equal(products.length, 104);
    assert.equal(new Set(products.map(p => p.id)).size, 104);
    assert.equal(products.reduce((n, p) => n + p.variants.length, 0), 147);
    assert.equal(first.body.metadata.priceStatus, 'not_collected');
    assert.equal((await call(app.base, '/api/catalog', undefined, 'bad')).status, 401);
    assert.equal((await call(app.base, '/api/catalog?limit=105')).status, 400);
    assert.equal((await call(app.base, '/api/catalog?offset=-1')).status, 400);
    const coffee = await call(app.base, '/api/catalog?category=' + encodeURIComponent('麦咖啡'));
    assert.ok(coffee.body.products.every(p => p.category === '麦咖啡'));
  } finally { await app.close(); }
});

test('用户可选择第二份方案，确认后仍按服务端快照计价', async () => {
  const app = await startServer();
  try {
    const plan = await call(app.base, '/api/plan', { text: '一个人吃，30元以内，无糖饮料', context: { ...CONTEXT, budget: null } });
    const selected = plan.body.quotes[1];
    assert.ok(Number(selected.total) <= 30);
    const attempt = await call(app.base, '/api/confirm', {
      quoteId: selected.id, takeWayCode: selected.takeWays[0].code, confirmed: true, total: '0.01'
    });
    assert.equal(attempt.body.order.total, selected.total);
  } finally { await app.close(); }
});

test('预算不够时不硬凑方案', async () => {
  const app = await startServer();
  try {
    const plan = await call(app.base, '/api/plan', {
      text: '随便来点', context: { fulfillment: 'pickup', location: '上海', budget: 5 }
    });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.quote, undefined);
    assert.match(plan.body.message, /预算/);
  } finally {
    await app.close();
  }
});

test('口令不对返回 401，未知地址返回 404', async () => {
  const app = await startServer();
  try {
    const denied = await call(app.base, '/api/health', undefined, 'wrong-key-0000000000');
    assert.equal(denied.status, 401);

    const missing = await call(app.base, '/api/nothing');
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

test('参数不合法时给出中文提示', async () => {
  const app = await startServer();
  try {
    const empty = await call(app.base, '/api/plan', { text: '   ', context: CONTEXT });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /1到2000/);

    const badWay = await call(app.base, '/api/plan', {
      text: '吃汉堡', context: { fulfillment: 'teleport', location: '上海' }
    });
    assert.equal(badWay.status, 400);

    const badBudget = await call(app.base, '/api/plan', {
      text: '吃汉堡', context: { fulfillment: 'pickup', location: '上海', budget: 99999 }
    });
    assert.equal(badBudget.status, 400);
  } finally {
    await app.close();
  }
});

test('当前只启用官方麦当劳流程，截图和跨平台接口不再对外开放', async () => {
  const app = await startServer();
  try {
    for (const path of ['/api/platforms', '/api/captures']) assert.equal((await call(app.base, path)).status, 404);
    for (const path of ['/api/compare', '/api/captures/prepare', '/api/captures/confirm', '/api/offers/import']) assert.equal((await call(app.base, path, {})).status, 404);
    const result = await call(app.base, '/api/integration');
    assert.equal(result.status, 200);
    assert.equal(result.body.state, 'demo');
    assert.equal(result.body.upstreamChecked, false);
    assert.ok(result.body.features.every(f => f.available === null));
    assert.equal((await call(app.base, '/api/integration', undefined, 'wrong')).status, 401);
  } finally { await app.close(); }
});

test('官方接入核验覆盖门店、套餐、详情、优惠及计价，不把工具清单冒充真实价格', async () => {
  const toolNames = ['query-nearby-stores', 'delivery-query-addresses', 'delivery-query-stores', 'query-meals',
    'query-meal-detail', 'query-store-coupons', 'calculate-price', 'create-order', 'query-order'];
  for (const partial of [false, true]) {
    const tools = toolNames.filter(name => !partial || name !== 'query-meal-detail').map(name => ({ name }));
    let calls = 0;
    const app = await startServer(undefined, { config: { mode: 'live', mcdToken: 'test-mcp-secret', aiKey: 'test-ai-secret' },
      mcp: { ready: async () => tools, call: async () => { calls++; throw new Error('No data or order call allowed during connection check'); } } });
    try {
      assert.equal((await call(app.base, '/api/health')).body.upstreamChecked, false);
      const result = await call(app.base, '/api/check', {});
      assert.equal(result.status, partial ? 503 : 200);
      const status = (await call(app.base, '/api/integration')).body;
      assert.equal(status.state, partial ? 'partial' : 'ready');
      assert.equal(status.upstreamChecked, true);
      assert.equal(status.features.find(f => f.id === 'details').available, !partial);
      assert.ok(status.checkedAt);
      assert.equal(JSON.stringify(status).includes('test-mcp-secret'), false);
      assert.equal(JSON.stringify(status).includes('test-ai-secret'), false);
      assert.equal(calls, 0);
      assert.equal((await call(app.base, '/api/health')).body.upstreamChecked, true);
    } finally { await app.close(); }
  }
});

test('只配置MCP也可独立核验，AI未配置时继续明确使用演示价格', async () => {
  const names = ['query-nearby-stores', 'delivery-query-addresses', 'delivery-query-stores', 'query-meals', 'query-meal-detail',
    'query-store-coupons', 'calculate-price', 'create-order', 'query-order'];
  const app = await startServer(undefined, { config: { mcdToken: 'test-only-secret', aiKey: '' }, mcp: {
    ready: async () => names.map(name => ({ name })), call: async () => { throw new Error('No live pricing or order in demo'); }
  } });
  try {
    assert.equal((await call(app.base, '/api/integration')).body.state, 'demo_configured');
    const checked = await call(app.base, '/api/check', {});
    assert.equal(checked.status, 200);
    assert.equal(checked.body.integration.state, 'demo_connected');
    assert.equal(checked.body.integration.aiConfigured, false);
    assert.equal(checked.body.integration.upstreamChecked, true);
    assert.match(checked.body.message, /模拟价/);
    assert.equal((await call(app.base, '/api/health')).body.integration.state, 'demo_connected');
    const result = await call(app.base, '/api/plan', { text: '30元内套餐', context: { fulfillment: 'pickup', location: '广州', budget: 30 } });
    assert.equal(result.status, 200);
    assert.ok(result.body.quotes.every(q => q.demo && q.priceBasis === 'simulated'));
  } finally { await app.close(); }
});

test('重启时把「正在提交」的记录改成待核实，不当成没下单', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mcd-restart-'));
  writeFileSync(join(directory, 'orders.json'), JSON.stringify([
    { quoteId: 'q-1', status: 'submitting', createdAt: 1, demo: true, args: {}, order: null }
  ]));
  const app = await startServer(directory);
  try {
    const list = await call(app.base, '/api/orders');
    assert.equal(list.body.orders[0].status, 'unknown');
    assert.match(list.body.orders[0].message, /核实/);
    const saved = JSON.parse(readFileSync(join(directory, 'orders.json'), 'utf8'));
    assert.equal(saved[0].status, 'unknown');
  } finally {
    await app.close();
  }
});
