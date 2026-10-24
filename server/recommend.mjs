import { catalogRows, catalogProducts, catalogMeta } from './catalog.mjs';
import { demoPriceFen, DEMO_PRICE_NOTICE } from './demo-prices.mjs';
import { AppError } from './domain.mjs';

const numericPeople = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8 };
const breakfastSides = /^(脆薯饼|脆香油条|德式图林根香肠)$/;
const roleOf = r => r.category === '汉堡和卷' || (r.category === '早餐' && !breakfastSides.test(r.product_name)) ? 'main'
  : ['饮品', '麦咖啡'].includes(r.category) && !/阿芙佳朵|雪冰/.test(r.product_name) ? 'drink'
  : r.category === '甜品' || /阿芙佳朵|雪冰/.test(r.product_name) ? 'dessert' : r.category === '蘸酱' ? 'condiment' : 'side';
const noSugarDrink = r => /^(无糖可口可乐|纯悦饮用水)$/.test(r.product_name);
const localDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const variants = catalogRows.map(row => ({ row, role: roleOf(row), priceFen: demoPriceFen(row) }));
const negativeMention = (text, name) => {
  const index = text.indexOf(name);
  return index >= 0 && /(?:不吃|不要|不喝|不含|不加|去掉|不能)[^，。；,;]{0,6}$/.test(text.slice(0, index));
};

export function readPreferences(text, context = {}) {
  const amount = text.match(/(?:预算|不超过|最多|上限|以内)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)/);
  const peopleMatch = text.match(/([一两二三四五六七八]|\d+)\s*(?:个?人|位)/);
  const calorieMatch = text.match(/(\d+)\s*(?:千卡|大卡|kcal)/i);
  const budget = context.budget ?? (amount ? Number(amount[1]) : null);
  const people = context.people ?? (peopleMatch ? numericPeople[peopleMatch[1]] || Number(peopleMatch[1]) : 1);
  const maxCalories = context.maxCalories ?? (calorieMatch ? Number(calorieMatch[1]) : null);
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 2000)) throw new AppError('预算请填写0到2000元之间的金额。');
  if (!Number.isInteger(people) || people < 1 || people > 8) throw new AppError('用餐人数支持1到8人。');
  if (maxCalories !== null && (!Number.isFinite(maxCalories) || maxCalories <= 0 || maxCalories > 20000)) throw new AppError('热量上限请填写0到20000千卡之间的数值。');
  const mealPeriod = context.mealPeriod || (/早餐|早饭/.test(text) ? 'breakfast' : 'regular');
  if (!['breakfast', 'regular', 'all'].includes(mealPeriod)) throw new AppError('餐段支持 breakfast、regular 或 all。');
  const count = context.optionCount ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new AppError('方案数量支持1到5份。');
  const excludedIngredients = [];
  for (const [pattern, ingredient] of [[/(?:不吃|不要|不含)牛/, '牛肉'], [/(?:不吃|不要|不含)猪|不吃培根/, '猪'], [/(?:不吃|不要|不含)鸡/, '鸡'], [/(?:不吃|不要|不含)鱼/, '鱼'], [/(?:不喝|不要|不含)奶|去奶/, '奶']]) {
    if (pattern.test(text)) excludedIngredients.push(ingredient);
  }
  const explicit = context.requiredProducts || [];
  if (!Array.isArray(explicit) || explicit.length > 8 || explicit.some(id => typeof id !== 'string' || !catalogProducts.some(p => p.id === id))) throw new AppError('指定餐品需使用产品库中的 product id，最多8种。');
  // Prefer longest names to avoid interpreting "无糖可口可乐" as two products.
  let remaining = text;
  const requiredProducts = new Set(explicit);
  for (const p of [...catalogProducts].sort((a, b) => b.name.length - a.name.length)) {
    if (remaining.includes(p.name) && !negativeMention(remaining, p.name)) {
      requiredProducts.add(p.id);
      remaining = remaining.split(p.name).join(' ');
    }
  }
  return { budget, people, maxCalories, mealPeriod, optionCount: count, requiredProducts: [...requiredProducts],
    noSpicy: /不吃辣|不要辣|不辣|免辣/.test(text), sugarFree: /无糖|不喝糖|不要含糖/.test(text),
    wantDessert: /甜品|冰淇淋|麦旋风|新地|圆筒|阿芙佳朵/.test(text) && !/不要甜品|不吃甜品/.test(text),
    wantCoffee: /要咖啡|喝咖啡|来杯咖啡|美式|奶铁|玛奇朵|卡布奇诺/.test(text),
    excludedIngredients, blocked: /过敏|严格无辣|严格不辣|素食|生酮|低钠/.test(text),
    excludedProducts: catalogProducts.filter(p => negativeMention(text, p.name)).map(p => p.id) };
}

function allowed(item, prefs, day) {
  const r = item.row;
  if (r.promotion_start_date && day < r.promotion_start_date || r.promotion_end_date && day > r.promotion_end_date) return false;
  if (prefs.mealPeriod === 'regular' && r.category === '早餐' || prefs.mealPeriod === 'breakfast' && r.category === '汉堡和卷') return false;
  if (prefs.noSpicy && r.spice_tag !== '无明显辣味（推断）') return false;
  if (prefs.sugarFree && item.role === 'drink' && !noSugarDrink(r)) return false;
  if (prefs.excludedProducts.includes(r.product_id)) return false;
  const ingredients = `${r.main_ingredient_tags};${r.product_name}`;
  return !prefs.excludedIngredients.some(word => ingredients.includes(word));
}

function mergeItems(items) {
  const map = new Map();
  for (const { item, quantity } of items) {
    if (!quantity) continue;
    const old = map.get(item.row.record_id);
    if (old) old.quantity += quantity; else map.set(item.row.record_id, { item, quantity });
  }
  return [...map.values()];
}

export function summarizeNutrition(items) {
  const fields = { kcal: 'energy_kcal', proteinG: 'protein_g', fatG: 'fat_g', carbohydrateG: 'carbohydrate_g', sodiumMg: 'sodium_mg' };
  const result = {};
  for (const [key, field] of Object.entries(fields)) {
    const missing = items.filter(({ item }) => !Number.isFinite(item.row[field])).map(({ item }) => `${item.row.product_name}（${item.row.serving_label}）`);
    const knownTotal = Math.round(items.reduce((n, { item, quantity }) => n + (Number.isFinite(item.row[field]) ? item.row[field] * quantity : 0), 0) * 10) / 10;
    result[key] = { total: missing.length ? null : knownTotal, knownTotal, complete: !missing.length, missing };
  }
  return result;
}

const signatureOf = items => items.map(({ item, quantity }) => `${item.row.record_id}:${quantity}`).sort().join('|');
const similarity = (a, b) => {
  const x = new Set(a.items.map(i => i.item.row.product_id));
  const y = new Set(b.items.map(i => i.item.row.product_id));
  return [...x].filter(id => y.has(id)).length / new Set([...x, ...y]).size;
};
const profiles = [
  { key: 'economy', title: '省预算搭配', reason: '优先降低花费，保留主食和饮品。', score: c => -c.totalFen / 100 },
  { key: 'classic', title: '主食小食搭配', reason: '优先组合主食、饮品和小食，留出预算余量。', score: c => c.sideCount * 18 - c.dessertCount * 12 - Math.abs(c.totalFen - c.target * .78) / 180 },
  { key: 'protein', title: '蛋白参考搭配', reason: '优先比较营养记录完整的方案，按参考蛋白质含量排序。', score: c => c.nutrition.proteinG.complete ? c.nutrition.proteinG.total * 1.8 - c.totalFen / 250 - c.dessertCount * 18 : -10000 },
  { key: 'treat', title: '加份甜品搭配', reason: '在预算内增加甜品，换一种口味。', score: c => c.dessertCount * 24 - Math.abs(c.totalFen - c.target * .85) / 180 },
  { key: 'variety', title: '换个口味搭配', reason: '优先选择与前面方案不同的餐品。', score: c => c.items.length * 5 - c.totalFen / 500 }
];

export class RecommendationService {
  constructor({ now = () => new Date() } = {}) { this.now = now; this.recent = new Map(); }
  recommend(input) {
    const prefs = readPreferences(input.text, input.context);
    const base = { catalog: catalogMeta, preferences: prefs, priceBasis: 'simulated', notice: DEMO_PRICE_NOTICE };
    if (prefs.blocked) return { ...base, candidates: [], message: '资料的过敏原、完整配料及部分营养数据不齐，无法验证这项严格饮食要求。请先向官方门店核实。' };
    const day = localDay(this.now());
    const pool = variants.filter(v => allowed(v, prefs, day));
    const required = [];
    for (const id of prefs.requiredProducts) {
      const item = pool.find(p => p.row.product_id === id);
      if (!item) return { ...base, candidates: [], message: '指定餐品与当前餐段、口味要求或活动日期冲突，未放宽你的条件。请调整要求。' };
      required.push({ item, quantity: 1 });
    }
    const mainRequired = required.filter(x => x.item.role === 'main');
    const mains = pool.filter(v => v.role === 'main');
    const drinks = pool.filter(v => v.role === 'drink' && (!prefs.wantCoffee || v.row.category === '麦咖啡'));
    const sides = pool.filter(v => v.role === 'side');
    const desserts = pool.filter(v => v.role === 'dessert');
    // A high budget is a ceiling, not a goal to spend everything. Limit portions
    // to one main/drink per diner plus up to two shared add-ons per diner.
    const deliveryFen = input.context.fulfillment === 'delivery' ? 600 : 0;
    const target = Math.min(prefs.budget === null ? prefs.people * 3500 : Math.round(prefs.budget * 100), prefs.people * 5500 + deliveryFen);
    const budgetFen = prefs.budget === null ? Infinity : Math.round(prefs.budget * 100);
    const memoryKey = JSON.stringify({ prefs, text: input.text, location: input.context.location, fulfillment: input.context.fulfillment });
    const previous = this.recent.get(memoryKey) || [];
    // Keep only the strongest candidates per strategy and main selection. A large
    // budget must not retain hundreds of thousands of full nutrition objects.
    const buckets = new Map();
    const activeProfiles = profiles.slice(0, prefs.optionCount);
    const needMain = Math.max(0, prefs.people - mainRequired.length);
    const needDrink = Math.max(0, prefs.people - required.filter(x => x.item.role === 'drink').length);
    const extraSets = [[], ...sides.map(item => [{ item, quantity: prefs.people }]), ...desserts.map(item => [{ item, quantity: prefs.people }])];
    // Side + dessert combinations, rather than merely resizing the same burger.
    for (const side of sides) for (const dessert of desserts) extraSets.push([{ item: side, quantity: prefs.people }, { item: dessert, quantity: prefs.people }]);
    const mainChoices = needMain ? mains : [null];
    const drinkChoices = needDrink ? drinks : [null];
    let minimumFen = Infinity;
    for (let m = 0; m < mainChoices.length; m++) for (const drink of drinkChoices) for (const extras of extraSets) {
      const additions = [...required, ...extras];
      if (needMain) {
        // Multi-person meals may mix two main products; quantities still match diners.
        const main = mainChoices[m];
        const second = mainChoices[(m + 1) % mainChoices.length];
        const split = needMain > 1 && second.row.product_id !== main.row.product_id ? Math.floor(needMain / 2) : 0;
        additions.push({ item: main, quantity: needMain - split });
        if (split) additions.push({ item: second, quantity: split });
      }
      if (needDrink) additions.push({ item: drink, quantity: needDrink });
      const items = mergeItems(additions);
      if (items.length > 20 || items.some(x => x.quantity > 20)) continue;
      const dessertCount = items.filter(x => x.item.role === 'dessert').length;
      if (prefs.wantDessert && !dessertCount) continue;
      const totalFen = items.reduce((sum, x) => sum + x.item.priceFen * x.quantity, deliveryFen);
      let nutrition;
      if (prefs.maxCalories !== null) {
        nutrition = summarizeNutrition(items);
        if (!nutrition.kcal.complete || nutrition.kcal.total > prefs.maxCalories) continue;
      }
      if (totalFen > target && totalFen > budgetFen) { minimumFen = Math.min(minimumFen, totalFen); continue; }
      if (totalFen > budgetFen) { minimumFen = Math.min(minimumFen, totalFen); continue; }
      if (totalFen > target && extras.length) continue;
      nutrition ||= summarizeNutrition(items);
      const signature = signatureOf(items);
      const candidate = { signature, items, totalFen, deliveryFen, target, nutrition, dessertCount,
        sideCount: items.filter(x => x.item.role === 'side').length };
      const mainKey = items.filter(x => x.item.role === 'main').map(x => x.item.row.product_id).sort().join('|');
      for (const profile of activeProfiles) {
        const key = `${profile.key}:${mainKey}`;
        const bucket = buckets.get(key) || [];
        const score = profile.score(candidate) - (previous.includes(signature) ? 10000 : 0);
        if (bucket.length >= 8 && score <= bucket[bucket.length - 1].score) continue;
        if (bucket.some(entry => entry.candidate.signature === signature)) continue;
        bucket.push({ candidate, score });
        bucket.sort((a, b) => b.score - a.score);
        if (bucket.length > 8) bucket.pop();
        buckets.set(key, bucket);
      }
    }
    const candidates = new Map([...buckets.values()].flat().map(entry => [entry.candidate.signature, entry.candidate]));
    if (!candidates.size) return { ...base, candidates: [], minimumDemoTotal: Number.isFinite(minimumFen) ? (minimumFen / 100).toFixed(2) : null,
      message: `当前预算或饮食条件下没有完整搭配，未超预算或忽略条件。${Number.isFinite(minimumFen) ? `满足餐品条件的最低模拟金额为 ¥${(minimumFen / 100).toFixed(2)}（含模拟配送费）。` : '请调整餐段、人数或指定餐品。'}` };
    const selected = [];
    for (const profile of profiles.slice(0, prefs.optionCount)) {
      let best = null; let bestScore = -Infinity;
      for (const candidate of candidates.values()) {
        if (selected.some(c => c.signature === candidate.signature)) continue;
        const maxSimilarity = selected.reduce((n, c) => Math.max(n, similarity(candidate, c)), 0);
        const mainRepeated = selected.some(c => c.items.filter(x => x.item.role === 'main').map(x => x.item.row.product_id).sort().join() === candidate.items.filter(x => x.item.role === 'main').map(x => x.item.row.product_id).sort().join());
        const score = profile.score(candidate) - maxSimilarity * 45 - (mainRepeated ? 40 : 0) - (previous.includes(candidate.signature) ? 10000 : 0);
        if (score > bestScore) { bestScore = score; best = candidate; }
      }
      if (best) {
        let { title, reason } = profile;
        if (profile.key === 'classic' && !best.sideCount) { title = '简约主食搭配'; reason = '预算内先保留主食和饮品，没有为了凑小食超预算。'; }
        if (profile.key === 'protein' && !best.nutrition.proteinG.complete) { title = '换口味搭配'; reason = '蛋白质资料不全，改为提供不同口味，不声称营养更优。'; }
        if (profile.key === 'treat' && !best.dessertCount) { title = '换口味搭配'; reason = '当前条件下未加入甜品，提供另一种餐品组合。'; }
        selected.push({ ...best, title, strategy: profile.key, reason });
      }
    }
    this.recent.set(memoryKey, [...previous, ...selected.map(c => c.signature)].slice(-30));
    if (this.recent.size > 100) this.recent.delete(this.recent.keys().next().value);
    const caveats = [DEMO_PRICE_NOTICE, '营养值为所选规格的历史参考；未知数据不按0计算。'];
    if (prefs.noSpicy || prefs.excludedIngredients.length) caveats.push('已按资料过滤已知口味/主料，部分依据为推断，无法保证无辣或无交叉接触。');
    if (prefs.mealPeriod === 'all') caveats.push('跨餐段仅作搭配参考，不保证能同时购买。');
    return { ...base, candidates: selected, caveats,
      message: `已从广州产品参考库生成 ${selected.length} 种${prefs.people}人搭配${prefs.budget === null ? '（未设预算上限）' : `，总额均不超过 ¥${prefs.budget.toFixed(2)}` }。${selected.length < prefs.optionCount ? '符合条件的不同组合有限，没有重复凑数。' : '可比较后选择，也可再生成换一批。'}金额为模拟价。` };
  }
}
