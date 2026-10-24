// 金额单位换算、订单字段整理和参数校验的单元测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, equalSecret, normalizeOrder, normalizePrice, validate } from '../server/domain.mjs';

const priceFixture = () => ({
  price: 2690,
  deliveryPrice: 0,
  discount: 300,
  productList: [
    { productCode: 'P1', productName: '汉堡', quantity: 1, subtotal: 2290 },
    { productCode: 'P2', productName: '无糖可乐', quantity: 1, subtotal: 400 }
  ],
  takeWayList: [{ takeWayCode: 'T1', takeWayName: '外带' }]
});

test('calculate-price 的整数「分」换算成元，不能统一除以100到订单字段', () => {
  const normalized = normalizePrice(priceFixture());
  assert.equal(normalized.totalFen, 2690);
  assert.equal(normalized.total, '26.90');
  assert.equal(normalized.discount, '3.00');
  assert.equal(normalized.lines[0].subtotal, '22.90');
  assert.equal(normalized.takeWays[0].name, '外带');
  assert.ok(normalized.fingerprint);
});

test('计价响应结构不认识时直接停下，不猜金额', () => {
  assert.throws(() => normalizePrice({ price: '26.9', productList: [] }), AppError);
  const bad = priceFixture();
  bad.productList[0].subtotal = 12.5;
  assert.throws(() => normalizePrice(bad), /计价/);
});

test('订单里的支付链接只接受官方域名', () => {
  const official = normalizeOrder({
    orderId: 123, orderDetail: { orderStatus: '已支付', storeName: '某门店', realTotalAmount: '26.90' },
    payH5Url: 'https://m.mcd.cn/pay/abc'
  });
  assert.equal(official.orderId, '123');
  assert.equal(official.total, '26.90');
  assert.equal(official.payUrl, 'https://m.mcd.cn/pay/abc');

  const fake = normalizeOrder({ orderId: 9, orderDetail: {}, payH5Url: 'https://evil.example.com/pay' });
  assert.equal(fake.payUrl, '');
  assert.equal(fake.orderStatus, '状态待查询');
});

test('官方返回缺取餐信息时不自己编一个', () => {
  const order = normalizeOrder({ orderId: 5, orderDetail: { orderStatus: '备餐中' } });
  assert.equal(order.pickupCode, '');
  assert.equal(order.lockerCode, '');
});

test('参数校验拒绝缺失、类型不符和枚举外的值', () => {
  const schema = {
    type: 'object',
    properties: { beType: { type: 'integer', enum: [1, 2] }, storeCode: { type: 'string' } },
    required: ['beType', 'storeCode'],
    additionalProperties: false
  };
  validate({ beType: 1, storeCode: 'S1' }, schema);
  assert.throws(() => validate({ beType: 1 }, schema), /缺少/);
  assert.throws(() => validate({ beType: 3, storeCode: 'S1' }, schema), /允许的选项/);
  assert.throws(() => validate({ beType: 1, storeCode: 'S1', extra: 1 }, schema), /未知字段/);
  assert.throws(() => validate({ beType: '1', storeCode: 'S1' }, schema), /允许的选项/);
  assert.throws(() => validate({ beType: 1, storeCode: 1 }, schema), /类型/);
});

test('口令比较按长度和内容一起比', () => {
  assert.equal(equalSecret('Bearer abc', 'Bearer abc'), true);
  assert.equal(equalSecret('Bearer abc', 'Bearer abd'), false);
  assert.equal(equalSecret('Bearer abc', 'Bearer abcd'), false);
  assert.equal(equalSecret(undefined, 'Bearer abc'), false);
});