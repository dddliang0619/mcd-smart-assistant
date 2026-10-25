import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultMealItem } from '../server/default-meal.mjs';
import { OrderingAgent } from '../server/agent.mjs';
import { OrderService } from '../server/domain.mjs';

const detail = () => ({ code: 'TEST-COMBO', name: '测试固定套餐', rounds: [
  { id: 1, quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [{ code: 'MAIN', name: '测试主食', quantity: 1, isDefault: 1 }] },
  { id: 2, quantity: 1, minQuantity: 1, maxQuantity: 1, choices: [{ code: 'FRIES', name: '测试中薯', quantity: 1, isDefault: 1 }, { code: 'OTHER', name: '测试替换项', quantity: 1, isDefault: 0 }] }
] });
test('默认套餐仅使用官方明确标记的默认子项，数量按每份原样组装', () => {
  const result = defaultMealItem(detail(), 'TEST-COMBO', 2);
  assert.equal(result.item.quantity, 2);
  assert.deepEqual(result.item.roundList, [{ round: '1', comboItemList: [{ code: 'MAIN', quantity: 1 }] }, { round: '2', comboItemList: [{ code: 'FRIES', quantity: 1 }] }]);
  assert.match(result.compositionText, /测试主食/);
  assert.equal(JSON.stringify(result).includes('OTHER'), false);
  assert.equal(Object.hasOwn(result.item, 'withOrder'), false);
});
test('缺失默认项、分组数量不符或编码不符时停止，不自动猜选项', () => {
  assert.throws(() => defaultMealItem(detail(), 'WRONG'), /不一致/);
  const missing = detail(); missing.rounds[0].choices[0].isDefault = 0;
  assert.throws(() => defaultMealItem(missing, 'TEST-COMBO'), /默认选项/);
  const wrong = detail(); wrong.rounds[0].choices[0].quantity = 2;
  assert.throws(() => defaultMealItem(wrong, 'TEST-COMBO'), /数量/);
});

test('默认套餐工具从门店菜单取码、读取详情再官方核价，保存完整子项且不下单', async () => {
  const common = { storeCode: { type: 'string' }, beType: { type: 'integer' }, orderType: { type: 'integer' } };
  const schema = properties => ({ type: 'object', properties, additionalProperties: false });
  const priceSchema = schema({ ...common, items: { type: 'array' } });
  const tools = [
    { name: 'query-nearby-stores', inputSchema: schema({}) },
    { name: 'query-meals', inputSchema: schema({ storeCode: { type: 'string' } }) },
    { name: 'query-meal-detail', inputSchema: schema({ ...common, code: { type: 'string' } }) },
    { name: 'calculate-price', inputSchema: priceSchema }, { name: 'create-order', inputSchema: priceSchema }
  ];
  const calls = [];
  const mcp = { ready: async () => tools, call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'query-nearby-stores') return [{ storeCode: 'TEST-STORE', storeName: '测试门店' }];
    if (name === 'query-meals') return { meals: { 'TEST-COMBO': { name: '测试套餐' } } };
    if (name === 'query-meal-detail') return detail();
    if (name === 'calculate-price') return { price: 3250, productList: [{ productCode: 'TEST-COMBO', productName: '测试套餐', quantity: 1, subtotal: 3250 }], takeWayList: [{ code: 'TAKE', name: '测试外带' }] };
    assert.fail('不得调用下单工具');
  } };
  const call = (name, args, id) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  let round = 0;
  const orders = new OrderService({ mode: 'live', mcp });
  const agent = new OrderingAgent({ mcp, orders, config: { aiBaseUrl: 'https://compatible.example/v1', aiModel: 'test', aiKey: 'test' }, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    if (body.tool_choice) assert.deepEqual(body.tools.map(t => t.function.name), [body.tool_choice.function.name]);
    else assert.ok(body.tools.some(t => t.function.name === 'price_default_meal'));
    let tool_calls;
    if (round++ === 0) tool_calls = [call('query-nearby-stores', {}, 'store'), call('query-meals', { storeCode: 'TEST-STORE' }, 'menu')];
    else if (round === 2) tool_calls = [call('price_default_meal', { storeCode: 'TEST-STORE', beType: 1, orderType: 1, productCode: 'TEST-COMBO', quantity: 1 }, 'default')];
    else {
      const result = JSON.parse(body.messages.find(m => m.tool_call_id === 'default').content);
      assert.equal(result.totalYuan, '32.50');
      assert.equal(result.rounds, undefined, 'AI只需价格与默认组成摘要');
      tool_calls = [call('present_plan', { quoteRef: result.localQuoteRef, addressId: '', remark: '', note: '', title: '测试默认套餐' }, 'present')];
    }
    return { ok: true, json: async () => ({ choices: [{ message: { tool_calls } }] }) };
  } });
  const result = await agent.plan({ text: '普通套餐，不替换', context: { fulfillment: 'pickup', location: '测试门店', budget: 40, people: 1 } });
  assert.equal(result.quote.total, '32.50');
  assert.equal(result.quote.demo, false);
  assert.match(result.quote.note, /测试主食.*测试中薯/);
  assert.deepEqual(calls.map(c => c.name), ['query-nearby-stores', 'query-meals', 'query-meal-detail', 'calculate-price']);
  assert.equal(calls.at(-1).args.items[0].roundList.length, 2);
  assert.equal(orders.attempts.size, 0);
});
