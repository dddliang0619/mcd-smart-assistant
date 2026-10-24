// 后端返回的金额已经是「元」字符串，这里只做显示和校验用的整理。

function money(value) {
  const number = Number(value);
  if (!isFinite(number)) return '—';
  return number.toFixed(2);
}

function fulfillmentText(value) {
  return value === 'delivery' ? '外送' : '到店自取';
}

// 把后端的报价对象整理成页面直接能用的字段。
function toQuoteView(quote) {
  const lines = (quote.lines || []).map((line) => ({
    code: line.code,
    name: line.name,
    quantity: line.quantity,
    subtotal: money(line.subtotal)
  }));
  return {
    id: quote.id,
    title: quote.title || '配餐方案',
    people: quote.people || 1,
    priceBasis: quote.priceBasis || (quote.demo ? 'simulated' : 'official'),
    nutritionSummary: quote.nutrition && quote.nutrition.kcal
      ? (quote.nutrition.kcal.complete ? '参考热量 ' + quote.nutrition.kcal.total + ' 千卡'
        : '已知部分热量 ' + quote.nutrition.kcal.knownTotal + ' 千卡（资料不全）') : '',
    foodSubtotal: money(lines.reduce((sum, line) => sum + Number(line.subtotal), 0)),
    lines: lines,
    total: money(quote.total),
    delivery: money(quote.delivery),
    discount: money(quote.discount),
    storeName: (quote.store && quote.store.name) || '',
    storeAddress: (quote.store && quote.store.address) || '',
    destination: quote.destination || '',
    fulfillment: quote.fulfillment || fulfillmentText(quote.fulfillmentType),
    storeCode: quote.storeCode || '',
    note: quote.note || '',
    demo: !!quote.demo,
    takeWays: quote.takeWays || [],
    createdAtText: formatTime(quote.createdAt),
    expiresAtText: formatTime(quote.expiresAt)
  };
}

function formatTime(value) {
  const time = Number(value);
  if (!isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

const STATUS_TEXT = {
  submitting: '正在提交',
  created: '已创建订单',
  unknown: '待核实'
};

function statusText(status) {
  return STATUS_TEXT[status] || '未知状态';
}

module.exports = { money, toQuoteView, fulfillmentText, statusText, formatTime };
