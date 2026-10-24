import { AppError } from './domain.mjs';
import { RecommendationService, readPreferences } from './recommend.mjs';
import { DEMO_PRICE_NOTICE } from './demo-prices.mjs';

const defaultRecommender = new RecommendationService();
export function demoPlan(input, orders, recommender = defaultRecommender) {
  const result = recommender.recommend(input);
  const { candidates, ...publicResult } = result;
  const isDelivery = input.context.fulfillment === 'delivery';
  const quotes = candidates.map(candidate => {
    const productList = candidate.items.map(({ item, quantity }) => ({
      productCode: `DEMO-${item.row.record_id}`, productName: `${item.row.product_name}（${item.row.serving_label}）`,
      quantity, subtotal: item.priceFen * quantity
    }));
    const price = { price: candidate.totalFen, deliveryPrice: candidate.deliveryFen, discount: 0, productList,
      takeWayList: isDelivery ? [] : [{ code: 'DEMO-TAKEOUT', name: '外带自取（演示）' }, { code: 'DEMO-DINEIN', name: '堂食（演示）' }] };
    const args = { storeCode: 'DEMO-GUANGZHOU', beType: isDelivery ? 2 : 1, orderType: isDelivery ? 2 : 1,
      items: productList.map(p => ({ productCode: p.productCode, quantity: p.quantity })) };
    return orders.addQuote({ priceArgs: args, orderArgs: args, price, budget: result.preferences.budget,
      store: { name: '广州产品库 · 演示搭配（非真实门店）', address: input.context.location || '广州门店供应待核验' },
      destination: isDelivery ? '演示收货地址 · 未读取你的账号' : '',
      note: `${candidate.reason} ${DEMO_PRICE_NOTICE} ${(result.caveats || []).slice(1).join(' ')}`,
      demo: true, title: candidate.title, strategy: candidate.strategy, nutrition: candidate.nutrition,
      priceBasis: 'simulated', people: result.preferences.people, catalog: result.catalog });
  });
  return { ...publicResult, quotes, ...(quotes.length ? { quote: quotes[0] } : {}) };
}

export function checkInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('请求内容必须是对象。');
  if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000) throw new AppError('请输入1到2000字的点餐要求。');
  const context = body.context || {};
  if (!['pickup', 'delivery'].includes(context.fulfillment)) throw new AppError('请选择到店自取或外送。');
  if (typeof context.location !== 'string' || context.location.length > 300) throw new AppError('位置最多300字。');
  const rawBudget = context.budget;
  if (rawBudget !== undefined && rawBudget !== null && rawBudget !== '' && !['number', 'string'].includes(typeof rawBudget)) throw new AppError('预算格式不正确。');
  const budget = rawBudget === null || rawBudget === '' || rawBudget === undefined ? null : Number(rawBudget);
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 2000)) throw new AppError('预算请填写0到2000元之间的金额，或留空。');
  if (body.history !== undefined && (!Array.isArray(body.history) || body.history.length > 20)) throw new AppError('对话记录格式不正确。');
  const input = { text: body.text.trim(), history: body.history || [], context: { ...context, fulfillment: context.fulfillment, location: context.location.trim(), budget } };
  const prefs = readPreferences(input.text, input.context);
  input.context = { ...input.context, budget: prefs.budget, people: prefs.people, mealPeriod: prefs.mealPeriod,
    maxCalories: prefs.maxCalories, optionCount: prefs.optionCount };
  return input;
}
