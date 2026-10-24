import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { catalogMeta, catalogRows, catalogProducts } from '../server/catalog.mjs';
import { RecommendationService, readPreferences } from '../server/recommend.mjs';
import { checkInput, demoPlan } from '../server/demo.mjs';
import { OrderService } from '../server/domain.mjs';

const recommender = () => new RecommendationService({ now: () => new Date('2026-10-24T04:00:00Z') });
const input = (budget, extra = {}, text = '想要多样搭配') => checkInput({ text, context: { fulfillment: 'pickup', location: '广州天河', budget, ...extra } });
const signature = c => c.items.map(x => x.item.row.record_id + ':' + x.quantity).sort().join('|');

test('完整保留原始104款147规格资料及缺失字段，不臆造售价', () => {
  const raw = readFileSync(new URL('../data/catalog-source.json', import.meta.url));
  assert.equal(catalogMeta.sourceSha256, createHash('sha256').update(raw).digest('hex'));
  assert.deepEqual(catalogRows, JSON.parse(raw));
  assert.equal(catalogProducts.length, 104);
  assert.equal(catalogRows.length, 147);
  assert.equal(catalogRows.filter(r => r.energy_kcal === null).length, 23);
  assert.ok(catalogRows.every(r => r.store_verified === 0 && !Object.hasOwn(r, 'price')));
});

test('15/20/30/50/80预算分别返回不同搭配，总额与明细一致且不超预算', () => {
  const service = recommender();
  for (const budget of [15, 20, 30, 50, 80]) {
    const result = service.recommend(input(budget));
    assert.equal(result.candidates.length, 3);
    assert.equal(new Set(result.candidates.map(signature)).size, 3);
    const mains = new Set();
    for (const c of result.candidates) {
      assert.ok(c.totalFen <= budget * 100);
      assert.equal(c.totalFen, c.items.reduce((n, x) => n + x.item.priceFen * x.quantity, c.deliveryFen));
      for (const x of c.items.filter(x => x.item.role === 'main')) mains.add(x.item.row.product_id);
      assert.ok(!c.items.some(x => x.item.role === 'condiment'), '不能把一份蘸酱当小食凑套餐');
    }
    assert.ok(mains.size >= 2, '不只是给同一汉堡改尺寸');
  }
});

test('换一批优先避开前一批完整组合', () => {
  const service = recommender();
  const one = service.recommend(input(30));
  const two = service.recommend(input(30));
  assert.ok(two.candidates.every(c => !one.candidates.some(old => signature(old) === signature(c))));
});

test('外送含模拟配送费，预算不足不放宽条件', () => {
  const service = recommender();
  assert.equal(service.recommend(input(15, { fulfillment: 'delivery' })).candidates.length, 0);
  const result = service.recommend(input(30, { fulfillment: 'delivery' }));
  assert.equal(result.candidates.length, 3);
  assert.ok(result.candidates.every(c => c.deliveryFen === 600 && c.totalFen <= 3000));
  assert.equal(service.recommend(input(.01)).candidates.length, 0);
});

test('人数与文本预算能识别，按总预算安排每人的主食和饮品，高预算不堆份数', () => {
  const prefs = readPreferences('两个人，50元以内', { budget: null });
  assert.equal(prefs.people, 2); assert.equal(prefs.budget, 50);
  const result = recommender().recommend(input(null, {}, '两个人，50元以内'));
  assert.ok(result.candidates.length);
  for (const c of result.candidates) {
    for (const role of ['main', 'drink']) assert.equal(c.items.filter(x => x.item.role === role).reduce((n, x) => n + x.quantity, 0), 2);
    assert.ok(c.totalFen <= 5000);
  }
  const high = recommender().recommend(input(500));
  assert.ok(high.candidates.every(c => c.items.reduce((n, x) => n + x.quantity, 0) <= 4));
});

test('按不辣/无糖/不吃牛过滤，有推断的口味不冒充官方保证', () => {
  const result = recommender().recommend(input(40, {}, '一个人，不吃辣，不吃牛，要无糖饮料'));
  assert.ok(result.candidates.length);
  for (const c of result.candidates) for (const { item } of c.items) {
    assert.equal(item.row.spice_tag, '无明显辣味（推断）');
    assert.ok(!item.row.main_ingredient_tags.includes('牛肉'));
    if (item.role === 'drink') assert.match(item.row.product_name, /^(无糖可口可乐|纯悦饮用水)$/);
  }
  assert.ok(result.caveats.some(n => n.includes('推断')));
  assert.equal(recommender().recommend(input(40, {}, '乳制品过敏')).candidates.length, 0);
});

test('指定餐品不被换掉，缺失营养不算0，严格热量限制排除未知方案', () => {
  const result = recommender().recommend(input(50, { requiredProducts: ['MCDGZ087'] }));
  assert.ok(result.candidates.length);
  for (const c of result.candidates) {
    assert.ok(c.items.some(x => x.item.row.product_id === 'MCDGZ087'));
    assert.equal(c.nutrition.kcal.total, null);
    assert.equal(c.nutrition.kcal.complete, false);
    assert.ok(c.nutrition.kcal.missing.length);
  }
  assert.equal(recommender().recommend(input(50, { requiredProducts: ['MCDGZ087'], maxCalories: 2000 })).candidates.length, 0);
  const capped = recommender().recommend(input(40, { maxCalories: 500 }));
  assert.ok(capped.candidates.length);
  assert.ok(capped.candidates.every(c => c.nutrition.kcal.complete && c.nutrition.kcal.total <= 500));
});

test('早餐与正餐分开，过期活动仍在目录但不参与推荐', () => {
  const breakfast = recommender().recommend(input(30, {}, '要早餐'));
  assert.ok(breakfast.candidates.length);
  assert.ok(breakfast.candidates.every(c => c.items.filter(x => x.item.role === 'main').every(x => x.item.row.category === '早餐')));
  const future = new RecommendationService({ now: () => new Date('2026-11-04T04:00:00Z') });
  assert.equal(future.recommend(input(50, { requiredProducts: ['MCDGZ087'] })).candidates.length, 0);
});

test('各档预算的方案使用服务端快照，模拟价和真实价格来源明确', () => {
  const orders = new OrderService({ mode: 'demo' });
  const result = demoPlan(input(30), orders, recommender());
  assert.equal(result.quotes.length, 3);
  assert.ok(result.quotes.every(q => q.demo && q.priceBasis === 'simulated' && q.note.includes('不是广州门店售价')));
  assert.ok(result.quotes.every(q => q.lines.every(l => l.code.startsWith('DEMO-MCDGZ'))));
});

test('非法人数/方案数量/热量/产品ID被拒绝', () => {
  for (const extra of [{ people: 9 }, { people: 1.5 }, { optionCount: 6 }, { maxCalories: -1 }, { requiredProducts: ['unknown'] }, { budget: true }]) {
    assert.throws(() => input(30, extra));
  }
  assert.throws(() => checkInput(null));
});
