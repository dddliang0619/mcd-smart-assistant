import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OrderingAgent } from '../server/agent.mjs';
import { OrderService } from '../server/domain.mjs';

const objectSchema = properties => ({ type: 'object', properties, additionalProperties: false });
const string = { type: 'string' };
const itemSchema = { type: 'array', items: { type: 'object', properties: { productCode: string, quantity: { type: 'integer' } }, required: ['productCode', 'quantity'] } };
const priceSchema = objectSchema({ storeCode: string, beType: { type: 'integer' }, items: itemSchema, withOrder: objectSchema({ cardId: string }) });
const tools = [
  { name: 'query-nearby-stores', inputSchema: objectSchema({ location: string }) },
  { name: 'query-meals', inputSchema: objectSchema({ storeCode: string }) },
  { name: 'calculate-price', inputSchema: priceSchema },
  { name: 'create-order', inputSchema: objectSchema({ ...priceSchema.properties, takeWayCode: string }) }
];
const context = { fulfillment: 'pickup', location: '广州', budget: 30, people: 1, optionCount: 3, maxCalories: null };
const functionCall = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const response = message => ({ ok: true, json: async () => ({ choices: [{ message }] }) });

function setup({ overBudget = false, duplicate = false, forged = false, aiBaseUrl = 'https://example.invalid', withOrder, aiReasoningEffort } = {}) {
  const calls = [];
  const mcp = { ready: async () => tools, call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'query-nearby-stores') return { stores: [{ storeCode: 'GZ-1', storeName: '广州测试门店', storeAddress: '广州' }] };
    if (name === 'query-meals') return { meals: [{ productCode: 'P1', productName: '主食一' }, { productCode: 'P2', productName: '主食二' }, { productCode: 'P3', productName: '主食三' }] };
    if (name === 'calculate-price') {
      const code = args.items[0].productCode;
      const fen = code === 'P1' ? 1900 : code === 'P2' ? 2400 : overBudget ? 3100 : 2900;
      return { price: fen, productList: [{ productCode: code, productName: '测试餐品' + code, quantity: 1, subtotal: fen }], deliveryPrice: 0, discount: 0,
        takeWayList: [{ code: 'TAKE', name: '外带' }] };
    }
    throw new Error('测试不允许创建订单');
  } };
  const orders = new OrderService({ mode: 'live', mcp });
  let round = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (aiReasoningEffort) assert.equal(body.reasoning_effort, aiReasoningEffort);
    else assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
    if (new URL(aiBaseUrl).hostname === 'api.deepseek.com') assert.deepEqual(body.thinking, { type: 'disabled' });
    else assert.equal(Object.hasOwn(body, 'thinking'), false, '兼容服务不发送DeepSeek专用参数');
    assert.ok(body.tools.some(t => t.function.name === 'search_catalog'));
    assert.ok(body.tools.some(t => t.function.name === 'present_plans'));
    if (round++ === 0) return response({ tool_calls: [
      functionCall('search_catalog', { query: '无糖', category: '饮品' }, 'catalog'),
      functionCall('query-nearby-stores', { location: '广州' }, 'store'),
      functionCall('query-meals', { storeCode: 'GZ-1' }, 'menu'),
      ...['P1', 'P2', forged ? 'MCDGZ001' : 'P3'].map((code, i) => functionCall('calculate-price', { storeCode: 'GZ-1', beType: 1, items: [{ productCode: code, quantity: 1 }], ...(withOrder ? { withOrder } : {}) }, 'price' + i))
    ] });
    if (round === 2) {
      const priced = body.messages.filter(m => m.role === 'tool' && m.tool_call_id.startsWith('price')).map(m => JSON.parse(m.content));
      if (forged) assert.match(priced[2].error, /真实菜单/);
      const plans = priced.map((p, i) => ({ quoteRef: p.localQuoteRef || 'forged-ref', addressId: '', remark: '', note: '按官方测试核价', title: '搭配' + i }));
      if (duplicate) plans[2] = plans[0];
      return response({ tool_calls: [functionCall('present_plans', { plans }, 'present')] });
    }
    return response({ content: '部分方案无法核验，未提交任何订单。' });
  };
  return { agent: new OrderingAgent({ mcp, orders, fetchImpl, config: { aiBaseUrl, aiModel: 'test', aiKey: 'test', aiReasoningEffort } }), orders, calls };
}

test('DeepSeek与兼容AI服务分开处理专用参数，两者均可执行工具配餐流程', async () => {
  for (const aiBaseUrl of ['https://api.deepseek.com', 'https://compatible.example/v1']) {
    const { agent } = setup({ aiBaseUrl });
    const result = await agent.plan({ text: '30元内三种搭配', context });
    assert.equal(result.quotes.length, 3);
  }
});

test('只在明确配置时发送兼容服务的推理强度参数', async () => {
  const { agent } = setup({ aiReasoningEffort: 'low' });
  const result = await agent.plan({ text: '40元内套餐', context });
  assert.equal(result.quotes.length, 3);
});

test('空随单购对象不触发会员购买，真实购卡参数仍在核价前被拦截', async () => {
  const empty = setup({ withOrder: {} });
  const result = await empty.agent.plan({ text: '普通套餐，不买会员', context });
  assert.equal(result.quotes.length, 3);
  assert.ok(empty.calls.filter(c => c.name === 'calculate-price').every(c => !Object.hasOwn(c.args, 'withOrder')));
  const purchase = setup({ withOrder: { cardId: 'test-card' } });
  const refused = await purchase.agent.plan({ text: '普通套餐，不买会员', context });
  assert.equal(refused.quotes, undefined);
  assert.equal(purchase.calls.filter(c => c.name === 'calculate-price').length, 0);
  assert.equal(purchase.calls.filter(c => c.name === 'create-order').length, 0);
});

test('真实模式返回3份分别官方核价的方案，本地目录仅作参考且不创建订单', async () => {
  const { agent, orders, calls } = setup();
  const result = await agent.plan({ text: '30元内三种搭配', context });
  assert.equal(result.quotes.length, 3);
  assert.deepEqual(result.quotes.map(q => q.total), ['19.00', '24.00', '29.00']);
  assert.ok(result.quotes.every(q => q.priceBasis === 'official' && !q.demo));
  assert.equal(orders.quotes.size, 3);
  assert.equal(calls.filter(c => c.name === 'calculate-price').length, 3);
  assert.ok(!calls.some(c => c.name === 'create-order'));
});

test('真实多方案整批校验：超预算/重复/伪造本地编码不能生成可选择报价', async () => {
  for (const options of [{ overBudget: true }, { duplicate: true }, { forged: true }]) {
    const { agent, orders, calls } = setup(options);
    const result = await agent.plan({ text: '30元内多种搭配', context });
    assert.equal(result.quotes, undefined);
    assert.equal(orders.quotes.size, 0);
    assert.ok(!calls.some(c => c.name === 'create-order'));
    if (options.forged) assert.ok(!calls.some(c => c.name === 'calculate-price' && c.args.items[0].productCode === 'MCDGZ001'));
  }
});

test('AI限流、超时与网关故障明确返回错误，不创建订单或返回模拟价', async () => {
  for (const [kind, status, pattern] of [['rate', 429, /限流/], ['timeout', 504, /超时/], ['gateway', 502, /HTTP 502/]]) {
    let reads = 0;
    const mcp = { ready: async () => tools, call: async () => { reads++; throw new Error('No calls expected'); } };
    const orders = new OrderService({ mode: 'live', mcp });
    const agent = new OrderingAgent({ mcp, orders, config: { aiBaseUrl: 'https://compatible.example/v1', aiModel: 'test', aiKey: 'test-secret' },
      fetchImpl: async () => { if (kind === 'timeout') throw new DOMException('fixture timeout', 'TimeoutError'); return { ok: false, status: kind === 'rate' ? 429 : 502, body: { cancel: async () => {} } }; } });
    await assert.rejects(agent.plan({ text: '40元以内套餐', context }), error => error.status === status && pattern.test(error.message) && /未提交订单/.test(error.message));
    assert.equal(orders.quotes.size, 0);
    assert.equal(orders.attempts.size, 0);
    assert.equal(reads, 0);
  }
});
