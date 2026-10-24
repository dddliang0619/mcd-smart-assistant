import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export class AppError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; }
}
export function equalSecret(actual, expected) {
  const a = Buffer.from(actual || ''); const b = Buffer.from(expected || '');
  return a.length === b.length && timingSafeEqual(a, b);
}
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function walk(value, fn) {
  if (!value || typeof value !== 'object') return;
  fn(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child, fn);
}

// Validate the JSON-schema vocabulary used by MCP tools, without coercing IDs.
export function validate(value, schema, path = '参数', root = schema) {
  if (!schema || schema === true) return;
  if (schema === false) throw new AppError(`${path} 不允许使用。`);
  if (schema.$ref) {
    if (!schema.$ref.startsWith('#/')) throw new AppError('不支持外部参数定义。');
    const target = schema.$ref.slice(2).split('/').reduce((v, k) => v?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root);
    if (!target) throw new AppError('接口参数定义无效。');
    validate(value, target, path, root);
  }
  for (const sub of schema.allOf || []) validate(value, sub, path, root);
  for (const mode of ['anyOf', 'oneOf']) if (schema[mode]) {
    const successes = schema[mode].filter(sub => { try { validate(value, sub, path, root); return true; } catch { return false; } }).length;
    if (!successes || (mode === 'oneOf' && successes !== 1)) throw new AppError(`${path} 格式不符合接口要求。`);
  }
  if (schema.enum && !schema.enum.some(item => stable(item) === stable(value))) throw new AppError(`${path} 不是允许的选项。`);
  if (Object.hasOwn(schema, 'const') && stable(schema.const) !== stable(value)) throw new AppError(`${path} 值不正确。`);
  const types = schema.type ? [schema.type].flat() : [];
  const matches = type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : typeof value === type && (type !== 'number' || Number.isFinite(value));
  if (types.length && !types.some(matches)) throw new AppError(`${path} 类型不正确。`);
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) throw new AppError(`${path} 数量不正确。`);
    if (schema.uniqueItems && new Set(value.map(stable)).size !== value.length) throw new AppError(`${path} 不能重复。`);
    value.forEach((item, i) => validate(item, schema.items, `${path}[${i}]`, root));
  } else if (value && typeof value === 'object') {
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new AppError(`${path} 缺少 ${key}。`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${path}.${key}`, root);
      else if (schema.additionalProperties === false) throw new AppError(`${path} 含未知字段 ${key}。`);
      else if (typeof schema.additionalProperties === 'object') validate(item, schema.additionalProperties, `${path}.${key}`, root);
    }
  } else if (typeof value === 'number') {
    if (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) throw new AppError(`${path} 超出范围。`);
  } else if (typeof value === 'string') {
    if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) throw new AppError(`${path} 长度不正确。`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) throw new AppError(`${path} 格式不正确。`);
  }
}

export function normalizePrice(data) {
  // Official calculate-price returns integer fen; order detail returns yuan strings.
  if (!Number.isSafeInteger(data.price) || data.price < 0 || !Array.isArray(data.productList) || !data.productList.length) {
    throw new AppError('官方计价响应结构无法识别，已停止下单。需要按实际接口更新适配器。', 502);
  }
  const lines = data.productList.map(item => {
    if (!item.productCode || !item.productName || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isSafeInteger(item.subtotal) || item.subtotal < 0) throw new AppError('官方餐品计价信息不完整，已停止下单。', 502);
    return { code: String(item.productCode), name: item.productName, quantity: item.quantity, subtotalFen: item.subtotal, subtotal: (item.subtotal / 100).toFixed(2) };
  });
  const takeWays = (data.takeWayList || []).map(item => ({ code: item.takeWayCode ?? item.code, name: item.takeWayName ?? item.name })).filter(item => item.code !== undefined && item.name);
  return {
    totalFen: data.price, total: (data.price / 100).toFixed(2),
    delivery: (Number(data.deliveryPrice || 0) / 100).toFixed(2),
    discount: (Number(data.discount || 0) / 100).toFixed(2), lines, takeWays,
    fingerprint: stable({ price: data.price, productList: data.productList, deliveryPrice: data.deliveryPrice, discount: data.discount, takeWayList: data.takeWayList })
  };
}

export class OrderService {
  constructor({ mcp, directory, mode = 'live', now = () => Date.now() }) {
    this.mcp = mcp; this.directory = directory; this.mode = mode; this.now = now;
    this.quotes = new Map(); this.attempts = new Map();
    if (directory) {
      mkdirSync(directory, { recursive: true });
      this.file = join(directory, 'orders.json');
      if (existsSync(this.file)) {
        const records = JSON.parse(readFileSync(this.file, 'utf8'));
        for (const record of records) {
          if (record.status === 'submitting') record.status = 'unknown';
          this.attempts.set(record.quoteId, record);
        }
        this.persist();
      }
    }
  }
  persist() {
    if (!this.file) return;
    const temporary = `${this.file}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.attempts.values()], null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
  }
  addQuote({ priceArgs, orderArgs, price, store, destination, note, budget, demo = false,
    title = '', strategy = '', nutrition = null, priceBasis = 'official', people = 1, catalog = null }) {
    const normalized = normalizePrice(price);
    if (budget !== null && normalized.totalFen > Math.round(budget * 100)) throw new AppError(`这份方案需要 ¥${normalized.total}，超过预算，请调整餐品。`);
    const quote = { id: randomUUID(), createdAt: this.now(), expiresAt: this.now() + 5 * 60_000, priceArgs: structuredClone(priceArgs), orderArgs: structuredClone(orderArgs), normalized, store, destination, note, budget, demo, state: 'ready',
      title, strategy, nutrition, priceBasis, people, catalog };
    this.quotes.set(quote.id, quote);
    // Only a small bounded cache is needed for one person's pending quotes.
    if (this.quotes.size > 100) this.quotes.delete(this.quotes.keys().next().value);
    return this.publicQuote(quote);
  }
  publicQuote(q) {
    const { fingerprint, ...price } = q.normalized;
    return { id: q.id, expiresAt: q.expiresAt, ...price, store: q.store, destination: q.destination, note: q.note, demo: q.demo, fulfillment: Number(q.orderArgs.beType) === 2 ? '外送' : '到店自取', storeCode: String(q.orderArgs.storeCode),
      title: q.title, strategy: q.strategy, nutrition: q.nutrition, priceBasis: q.priceBasis, people: q.people, catalog: q.catalog };
  }
  publicAttempt(a) {
    return { quoteId: a.quoteId, status: a.status, createdAt: a.createdAt, demo: a.demo, order: a.order || null,
      message: a.status === 'unknown' || a.status === 'submitting' ? '提交结果尚未确认。请先到麦当劳官方订单核实，勿重新下单。' : a.message || '' };
  }
  async confirm({ quoteId, takeWayCode, confirmed }) {
    if (confirmed !== true) throw new AppError('请先核对方案并确认下单。');
    const previous = this.attempts.get(quoteId);
    if (previous) return this.publicAttempt(previous);
    const q = this.quotes.get(quoteId);
    if (!q) throw new AppError('方案不存在或服务已重启，请重新生成。', 404);
    if (q.state !== 'ready') throw new AppError('方案正在处理或已经更新，请勿重复提交。', 409);
    if (q.expiresAt <= this.now()) throw new AppError('报价已超过5分钟，请重新生成方案。', 410);
    if (q.demo !== (this.mode === 'demo')) throw new AppError('运行模式已改变，请重新生成。', 409);
    const args = structuredClone(q.orderArgs);
    if (Number(args.beType) === 1) {
      const option = q.normalized.takeWays.find(item => String(item.code) === String(takeWayCode));
      if (!option) throw new AppError('请从官方返回的选项中选择取餐方式。');
      args.takeWayCode = option.code;
    }
    q.state = 'checking';
    try {
      if (!q.demo) {
        const current = await this.mcp.call('calculate-price', q.priceArgs);
        const latest = normalizePrice(current);
        if (latest.fingerprint !== q.normalized.fingerprint) {
          const replacement = this.addQuote({ ...q, price: current });
          q.state = 'superseded';
          throw new AppError('门店报价或餐品发生变化，请核对更新后的方案再确认。', 409, { quote: replacement });
        }
        const tools = await this.mcp.ready();
        const schema = tools.find(t => t.name === 'create-order')?.inputSchema;
        if (!schema) throw new AppError('当前账号没有创建订单接口。', 503);
        validate(args, schema);
      }
    } catch (error) {
      if (q.state === 'checking') q.state = 'ready';
      throw error;
    }
    const attempt = { quoteId, status: 'submitting', createdAt: this.now(), demo: q.demo, args };
    this.attempts.set(quoteId, attempt);
    try { this.persist(); } catch (error) { this.attempts.delete(quoteId); q.state = 'ready'; throw new AppError('无法保存订单记录，已停止提交。', 500); }
    q.state = 'submitted';
    try {
      if (q.demo) {
        attempt.order = { orderId: `DEMO-${quoteId.slice(0, 8)}`, orderStatus: '演示完成 · 未真实下单', total: q.normalized.total, storeName: q.store.name, pickupCode: '', payUrl: '' };
      } else {
        const result = await this.mcp.call('create-order', args);
        attempt.order = normalizeOrder(result);
        if (!attempt.order.orderId) throw new Error('订单号缺失');
      }
      attempt.status = 'created';
      this.persist();
    } catch {
      attempt.status = 'unknown';
      // A failed write must not turn into another create-order call.
      try { this.persist(); } catch { /* The pre-submission durable record remains. */ }
    }
    return this.publicAttempt(attempt);
  }
  async refresh(quoteId) {
    const attempt = this.attempts.get(quoteId);
    if (!attempt) throw new AppError('没有找到订单记录。', 404);
    if (attempt.demo || !attempt.order?.orderId) return this.publicAttempt(attempt);
    const result = await this.mcp.call('query-order', { orderId: attempt.order.orderId });
    attempt.order = { ...normalizeOrder(result), payUrl: attempt.order.payUrl };
    this.persist(); return this.publicAttempt(attempt);
  }
  list() { return [...this.attempts.values()].filter(a => a.demo === (this.mode === 'demo')).reverse().slice(0, 20).map(a => this.publicAttempt(a)); }
}

export function normalizeOrder(data) {
  const detail = data.orderDetail || data;
  const rawUrl = data.payH5Url || detail.payH5Url || '';
  let payUrl = '';
  try {
    const parsed = new URL(rawUrl);
    const allowed = ['mcd.cn', 'mcdchina.net', 'mcdonalds.cn', 'mcdonalds.com.cn'];
    if (parsed.protocol === 'https:' && allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith(`.${d}`))) payUrl = rawUrl;
  } catch { /* No payment URL. Official app remains available. */ }
  return { orderId: String(data.orderId || detail.orderId || ''), orderStatus: detail.orderStatus || '状态待查询', storeName: detail.storeName || '',
    total: String(detail.realTotalAmount ?? detail.totalAmount ?? ''), pickupCode: detail.pickupCode || '', lockerCode: detail.lockerCode || '', payUrl };
}
