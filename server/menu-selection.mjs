import { AppError } from './domain.mjs';
import { defaultMealItem } from './default-meal.mjs';

const burger = /汉堡|厚牛堡|鸡腿堡|牛堡|猪柳堡|吉士堡|鳕鱼堡|麦香鱼|麦香鸡|巨无霸|不素之霸|松饼.*堡/;
const main = /汉堡|堡|麦香鱼|麦香鸡|巨无霸|不素之霸|鸡肉卷|鸡腿卷|米饭|意面|粥/;
const drink = /可乐|雪碧|纯悦|饮用水|牛奶|燕麦奶|奶铁|奶茶|奶绿|咖啡|美式|红茶|果汁|苹果汁|橙汁|柠柠|怡泉|黑巧|雪冰/;
const snack = /薯|鸡翅|麦乐鸡|鸡块|炸鸡|脆汁鸡|鸡排|肉骨鸡|玉米|苹果片|派|新地|圆筒|麦旋风|冰淇淋|拼盘|小食盘/;

export function livePreferences(text, context = {}) {
  const style = context.mealStyle || 'any';
  const beverage = context.drinkPreference || 'any';
  if (!['any', 'snacks', 'noBurger'].includes(style) || !['any', 'coke', 'sugarFreeCoke', 'none'].includes(beverage)) throw new AppError('餐品或饮料偏好无效。');
  const snacksOnly = style === 'snacks' || /只(?:想)?(?:吃|要|来点)[^，。；,;]{0,4}(?:小吃|小食|零食)|(?:小吃|小食)(?:为主|就好)/.test(text);
  const noBurger = snacksOnly || style === 'noBurger' || /不(?:想)?(?:要|吃)[^，。；,;]{0,4}(?:汉堡|堡类)/.test(text);
  const noDrink = beverage === 'none' || /(?:不要|不喝|不用)[^，。；,;]{0,3}(?:饮料|饮品)/.test(text);
  const noWater = /(?:不要|不喝|不想喝)[^，。；,;]{0,4}(?:纯悦|水)/.test(text);
  const noCoke = /(?:不要|不喝|不想喝)[^，。；,;]{0,3}(?:可乐|可口可乐)/.test(text);
  const sugarFree = beverage === 'sugarFreeCoke' || /(?:要|喝|换|只喝)[^，。；,;]{0,4}无糖(?:可口)?可乐|无糖饮料/.test(text);
  const wantCoke = beverage === 'coke' || beverage === 'sugarFreeCoke' || (!noCoke && /可乐/.test(text));
  const noSpicy = /不吃辣|不要辣|不辣|免辣/.test(text);
  if (wantCoke && (noDrink || noCoke) || beverage === 'coke' && sugarFree) throw new AppError('饮料要求有冲突，请确认要普通可乐、无糖可乐，还是不要饮料。');
  const excluded = [];
  for (const word of ['薯条', '鸡翅', '麦乐鸡', '鸡块', '咖啡', '牛肉', '猪肉', '培根']) {
    if (new RegExp('(?:不要|不吃|不喝|不想吃|不想喝)[^，。；,;]{0,3}' + word).test(text)) excluded.push(word);
  }
  return { snacksOnly, noBurger, noDrink, noWater, noCoke, sugarFree, wantCoke, noSpicy, excluded };
}

export function drinkMatches(name, prefs) {
  if (!/可乐/.test(name)) return false;
  if (/麦炫酷|麦旋风|冰淇淋|新地|雪冰|漂浮/.test(name)) return false;
  return prefs.sugarFree ? /无糖|零度/.test(name) : !/无糖|零度/.test(name);
}
function allowedName(name, prefs) {
  return !(prefs.noBurger && burger.test(name) || prefs.snacksOnly && main.test(name)
    || prefs.noDrink && drink.test(name) || prefs.noWater && /纯悦|饮用水/.test(name)
    || prefs.wantCoke && drink.test(name) && !drinkMatches(name, prefs)
    || prefs.sugarFree && drink.test(name) && !/无糖|零度|饮用水|纯悦/.test(name)
    || prefs.noSpicy && /辣|山葵|咖喱/.test(name)
    || prefs.noCoke && /可乐/.test(name) || prefs.excluded.some(s => name.includes(s)));
}

// Keep every official menu entry, including opaque bundle names and member offers.
// Menu prices are hints only; checkout quotes always come from calculate-price.
export function indexMenu(data, prefs) {
  const categories = new Map();
  for (const category of data.categories || []) for (const entry of category.meals || []) {
    const code = String(entry.code ?? entry.productCode ?? '');
    const old = categories.get(code) || { categories: [], tags: [] };
    old.categories.push(String(category.name || '').replace(/\n/g, ''));
    old.tags.push(...(entry.tags || [])); categories.set(code, old);
  }
  const source = Array.isArray(data.meals) ? data.meals.map(v => [v.productCode ?? v.code, v]) : Object.entries(data.meals || {});
  const items = source.filter(([code, v]) => code && (v.name || v.productName)).map(([code, v]) => {
    const name = v.name || v.productName;
    const meta = categories.get(String(code)) || { categories: [], tags: [] };
    return { code: String(code), name, menuPriceYuan: v.currentPrice ?? null, ...meta,
      needsCompositionCheck: /套餐|餐|件套|随心|精选|拼|乐园/.test(name) || meta.tags.includes('套餐'),
      preferenceHint: allowedName(name, prefs) ? '需按详情核对组成' : '名称可能冲突，只有实际子项满足要求时可用',
      canWithOrder: !!v.canWithOrder };
  });
  return { items, count: items.length, categoryNames: [...new Set(items.flatMap(i => i.categories))],
    note: '完整包含本次官方接口返回的全部菜单项目。名称不明确的套餐仍保留；按详情核对。目录价格不是最终实付价，会员资格与优惠须官方计价验证。' };
}

// Choose only codes and quantities from official rounds. A requested drink is
// chosen in a drink-capable round; it never replaces a mandatory main or snack.
export function preferredMealItem(detail, productCode, quantity, prefs) {
  if (!detail.rounds?.length) {
    const result = defaultMealItem(detail, productCode, quantity);
    if (!allowedName(detail.name || '', prefs)) throw new AppError('餐品不符合用户的餐品或饮料要求。');
    return result;
  }
  if (String(detail.code) !== String(productCode)) throw new AppError('官方详情编码不一致。');
  const adapted = structuredClone(detail);
  for (const round of adapted.rounds) {
    if (!Array.isArray(round.choices)) throw new AppError('官方套餐分组选项不完整。');
    const safe = round.choices.filter(c => typeof c.name === 'string' && allowedName(c.name, prefs));
    const requestedDrink = prefs.wantCoke ? safe.filter(c => drinkMatches(c.name, prefs)) : [];
    const defaults = round.choices.filter(c => c.isDefault === 1);
    const amount = Number.isInteger(round.quantity) && round.quantity > 0 ? round.quantity : defaults.reduce((n, c) => n + c.quantity, 0);
    if (!Number.isInteger(amount) || amount < 1 || amount > 20) throw new AppError('套餐分组数量不明确，请展开官方详情核对。');
    let chosen;
    if (requestedDrink.length) {
      chosen = requestedDrink.find(c => c.isDefault === 1) || requestedDrink[0];
    } else if (defaults.length && defaults.every(c => safe.includes(c))) continue;
    else chosen = safe.find(c => c.isDefault === 1) || safe[0];
    if (!chosen || (Number.isInteger(chosen.maxQuantity) && chosen.maxQuantity >= 0 && chosen.maxQuantity < amount)) throw new AppError('套餐必选分组无法满足你的要求，请换套餐或组合单点。');
    for (const c of round.choices) { c.isDefault = c === chosen ? 1 : 0; c.quantity = c === chosen ? amount : 0; }
  }
  const result = defaultMealItem(adapted, productCode, quantity);
  result.compositionText = result.compositionText.replace('每份默认组成：', '每份实际组成：');
  return result;
}

export function verifyMealSelection(detail, item, prefs) {
  const selectedNames = [];
  if (!detail || String(detail.code) !== String(item.productCode)) throw new AppError('缺少官方餐品详情，无法核对实际组成。');
  if (!detail.rounds?.length) selectedNames.push(detail.name);
  else {
    if (!Array.isArray(item.roundList) || item.roundList.length !== detail.rounds.length || new Set(item.roundList.map(r => r.round)).size !== detail.rounds.length) throw new AppError('套餐必选分组缺失或重复。');
    for (const round of detail.rounds) {
      const selected = item.roundList.find(r => r.round === String(round.id));
      if (!selected || !Array.isArray(selected.comboItemList)) throw new AppError('套餐必须包含全部官方必选子项。');
      let amount = 0;
      const codes = new Set();
      for (const child of selected.comboItemList) {
        const option = round.choices.find(c => c.code === child.code);
        if (!option || codes.has(child.code) || !Number.isInteger(child.quantity) || child.quantity < 1
          || (Number.isInteger(option.maxQuantity) && option.maxQuantity >= 0 && child.quantity > option.maxQuantity)) throw new AppError('套餐子项编码或数量不符合官方详情。');
        codes.add(child.code); amount += child.quantity; selectedNames.push(option.name);
      }
      if (Number.isInteger(round.quantity) && amount !== round.quantity || Number.isInteger(round.minQuantity) && amount < round.minQuantity
        || Number.isInteger(round.maxQuantity) && round.maxQuantity >= 0 && amount > round.maxQuantity) throw new AppError('套餐子项数量不符合官方分组要求。');
    }
    // A burger title with only preparation/size rounds is still a burger.
    if (burger.test(detail.name) && prefs.noBurger) throw new AppError('用户不要汉堡，不能以修改配料代替移除汉堡。');
  }
  if (selectedNames.some(n => typeof n !== 'string' || !allowedName(n, prefs))) throw new AppError('实际组成不符合用户的餐品或饮料要求，不能只改方案名称。');
  return selectedNames;
}

export function verifyPlanPreferences(names, prefs) {
  if (prefs.wantCoke && !names.some(n => drinkMatches(n, prefs))) throw new AppError('用户指定的可乐未包含在实际组成中，不能用纯悦、其他饮料或口头承诺代替。');
  if (prefs.snacksOnly && !names.some(n => snack.test(n))) throw new AppError('用户只想吃小吃，搭配必须包含真实小食，不能只给饮料。');
}

export const batchPriceSchema = { type: 'object', properties: {
  storeCode: { type: 'string' }, beType: { type: 'integer', enum: [1, 2] }, orderType: { type: 'integer', enum: [1, 2] }, beCode: { type: 'string' },
  candidates: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: {
    title: { type: 'string', maxLength: 40 }, items: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: {
      productCode: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 20 }, couponId: { type: 'string' }, couponCode: { type: 'string' }
    }, required: ['productCode', 'quantity'], additionalProperties: false } }
  }, required: ['title', 'items'], additionalProperties: false } }
}, required: ['storeCode', 'beType', 'orderType', 'candidates'], additionalProperties: false };
