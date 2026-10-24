import { AppError } from './domain.mjs';

// Build only defaults explicitly returned by the official meal-detail response.
export function defaultMealItem(detail, productCode, quantity = 1) {
  if (!detail || String(detail.code) !== String(productCode)) throw new AppError('官方套餐详情与餐品编码不一致，不能自动核价。');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) throw new AppError('套餐数量必须是1到20的整数。');
  const item = { productCode, quantity };
  const summary = [];
  if (detail.rounds !== undefined && !Array.isArray(detail.rounds)) throw new AppError('套餐组成格式无法识别，请改用详情核对。');
  if (detail.rounds?.length) {
    item.roundList = detail.rounds.map(round => {
      if (!['string', 'number'].includes(typeof round.id) || !String(round.id).trim() || !Array.isArray(round.choices)) throw new AppError('套餐分组选项不完整，不能猜默认搭配。');
      const choices = round.choices.filter(c => c.isDefault === 1);
      const comboItemList = choices.map(c => {
        if (typeof c.code !== 'string' || !c.code || typeof c.name !== 'string' || !Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 20) throw new AppError('套餐默认选项缺少餐品或数量，不能猜测。');
        summary.push(`${c.name} × ${c.quantity}`);
        return { code: c.code, quantity: c.quantity };
      });
      const amount = comboItemList.reduce((sum, c) => sum + c.quantity, 0);
      if (!amount || (Number.isInteger(round.quantity) && amount !== round.quantity)
        || (Number.isInteger(round.minQuantity) && amount < round.minQuantity)
        || (Number.isInteger(round.maxQuantity) && round.maxQuantity >= 0 && amount > round.maxQuantity)) throw new AppError('官方默认选项不满足套餐分组数量，请展开详情选择，不能自动补齐。');
      return { round: String(round.id), comboItemList };
    });
  }
  return { item, compositionText: summary.length ? '每份默认组成：' + summary.join('、') : '' };
}

export const defaultMealSchema = { type: 'object', properties: {
  storeCode: { type: 'string' }, beType: { type: 'integer', enum: [1, 2] }, orderType: { type: 'integer', enum: [1, 2] },
  beCode: { type: 'string' }, productCode: { type: 'string' }, quantity: { type: 'integer', minimum: 1, maximum: 20 },
  couponId: { type: 'string' }, couponCode: { type: 'string' }, needTableware: { type: 'boolean' }
}, required: ['storeCode', 'beType', 'orderType', 'productCode', 'quantity'], additionalProperties: false };
