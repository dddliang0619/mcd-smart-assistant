// Synthetic test fixtures. The collected catalog has NO prices. Never use these
// amounts in live mode or label them as a store price, discount, or official quote.
export const DEMO_PRICE_NOTICE = '金额为开发用模拟价，不是广州门店售价；实际价格和供应需由官方门店接口核验。';
const categoryFen = { '汉堡和卷': 1800, '小食': 900, '早餐': 1100, '甜品': 800, '饮品': 600, '麦咖啡': 1600, '组合餐': 2300, '蘸酱': 200 };
const overrides = {
  '汉堡包': 800, '吉士汉堡包': 1000, '双层吉士汉堡': 1500, '巨无霸': 2300,
  '麦香鸡': 1200, '麦香鱼': 1500, '板烧鸡腿堡': 1900, '麦辣鸡腿汉堡': 1900,
  '培根安格斯厚牛堡': 2900, '芝士安格斯厚牛堡': 2800,
  '薯条': 700, '玉米杯': 600, '苹果片': 500, '麦乐鸡': 1000,
  '麦麦脆汁鸡': 1400, '脆皮鸡柳': 1200, '圆筒冰淇淋': 400,
  '奥利奥麦旋风': 1200, '草莓麦旋风': 1200, '纯悦饮用水': 300,
  '无糖可口可乐': 500, '可口可乐': 500, '锡兰红茶': 400,
  '皮蛋鸡肉粥': 800, '雪菜脆笋鸡肉粥': 800, '脆薯饼': 500, '脆香油条': 500,
  '冰美式': 1200, '热美式': 1200
};
export function demoPriceFen(row) {
  const sizeExtra = { '中': 200, '大': 400 }[row.serving_label] || 0;
  return (overrides[row.product_name] ?? categoryFen[row.category]) + sizeExtra;
}
