// Read-only integration check. No order tool is exposed or executed.
// node --env-file=.env scripts/smoke-live.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { McdClient } from '../server/mcp.mjs';
import { loadConfig } from '../server/index.mjs';
import { OrderingAgent } from '../server/agent.mjs';
import { OrderService } from '../server/domain.mjs';

process.env.APP_MODE = 'live';
const location = process.env.SMOKE_LOCATION?.trim();
if (!location) throw new Error('请先在本机设置 SMOKE_LOCATION（公共地标或门店位置），再执行只读联调。');
const budget = Number(process.env.SMOKE_BUDGET || 40);
if (!Number.isFinite(budget) || budget <= 0 || budget > 2000) throw new Error('SMOKE_BUDGET 必须大于0且不超过2000元。');
const config = loadConfig();
mkdirSync(new URL('../.runtime/', import.meta.url), { recursive: true });
if (process.env.SMOKE_AI_MODEL) config.aiModel = process.env.SMOKE_AI_MODEL;
const upstream = new McdClient({ token: config.mcdToken });
const calls = [];
let aiRound = 0;
const tracedFetch = async (url, options) => {
  const round = ++aiRound;
  const started = Date.now();
  console.log(JSON.stringify({ aiRound: round, requestChars: options.body.length }));
  let response;
  try { response = await fetch(url, options); }
  catch (error) { console.log(JSON.stringify({ aiRound: round, error: error.name, cause: error.cause?.code, elapsedMs: Date.now() - started })); throw error; }
  console.log(JSON.stringify({ aiRound: round, status: response.status, elapsedMs: Date.now() - started }));
  return response;
};
const allowed = new Set(['query-nearby-stores', 'query-meals', 'query-meal-detail', 'query-store-coupons', 'query-my-coupons', 'calculate-price', 'list-nutrition-foods', 'now-time-info']);
const mcp = {
  ready: () => upstream.ready(),
  call: async (name, args) => {
    if (!allowed.has(name)) throw new Error('Smoke test permits pickup read-only calls only');
    calls.push(name);
    console.log(JSON.stringify({ tool: name, step: calls.length }));
    const data = await upstream.call(name, args);
    return data;
  }
};
try {
  const orders = new OrderService({ mode: 'live', mcp });
  const agent = new OrderingAgent({ config, mcp, orders, fetchImpl: tracedFetch });
  const result = await agent.plan({ text: `在指定位置到店自取，一个人，${budget}元以内，优先套餐，请给3种不同的搭配。只查询，不下单。`,
    context: { fulfillment: 'pickup', location, budget, people: 1, optionCount: 3, maxCalories: null } });
  const report = { checkedAt: new Date().toISOString(), message: result.message, priceBasis: result.priceBasis,
    quotes: (result.quotes || []).map(q => ({ title: q.title, total: q.total, store: q.store?.name, lines: q.lines, demo: q.demo, priceBasis: q.priceBasis })),
    calls, orderAttempts: orders.attempts.size };
  writeFileSync(new URL('../.runtime/live-smoke-result.json', import.meta.url), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
  if (!report.quotes.length || report.orderAttempts) process.exitCode = 1;
} catch (error) {
  let message = String(error.message || 'Integration failed');
  for (const secret of [config.aiKey, config.mcdToken]) if (secret) message = message.split(secret).join('[REDACTED]');
  message = message.replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]').slice(0, 500);
  const report = { checkedAt: new Date().toISOString(), failed: true, error: message, errorClass: error.constructor.name, code: error.cause?.code, calls, aiRound, orderAttempts: 0 };
  writeFileSync(new URL('../.runtime/live-smoke-result.json', import.meta.url), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
  process.exitCode = 1;
}
