// Read-only real integration: compare full returned menu, preferences and warm reads.
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../server/index.mjs';
import { McdClient } from '../server/mcp.mjs';
import { OrderingAgent } from '../server/agent.mjs';
import { OrderService } from '../server/domain.mjs';

process.env.APP_MODE = 'live';
const location = process.env.SMOKE_LOCATION?.trim();
if (!location) throw new Error('请先设置 SMOKE_LOCATION（公共地标或门店位置），再执行只读菜单联调。');
const config = loadConfig();
mkdirSync(new URL('../.runtime/', import.meta.url), { recursive: true });
const upstream = new McdClient({ token: config.mcdToken });
const allowed = new Set(['query-nearby-stores', 'query-meals', 'query-meal-detail', 'query-store-coupons', 'query-my-coupons', 'calculate-price', 'list-nutrition-foods', 'now-time-info']);
const mcp = { ready: () => upstream.ready(), call: async (name, args) => {
  if (!allowed.has(name)) throw new Error('This check only permits pickup reads, never orders');
  const started = Date.now();
  try { return await upstream.call(name, args); }
  finally { console.log(JSON.stringify({ tool: name, elapsedMs: Date.now() - started })); }
} };
const orders = new OrderService({ mode: 'live', mcp });
const agent = new OrderingAgent({ config, mcp, orders, fetchImpl: async (url, options) => {
  const body = JSON.parse(options.body);
  console.log(JSON.stringify({ forced: body.tool_choice?.function?.name || null, availableTools: body.tools.length }));
  for (const m of body.messages.slice(-8).filter(m => m.role === 'tool')) {
    const value = JSON.parse(m.content);
    if (value.error || value.candidates) console.log(JSON.stringify({ toolResult: m.tool_call_id, error: value.error, candidates: value.candidates?.map(c => ({ title: c.title, error: c.error, total: c.totalYuan, overBudget: c.overBudget })) }));
  }
  const started = Date.now(); const response = await fetch(url, options);
  if (response.ok) {
    const payload = await response.clone().json();
    console.log(JSON.stringify({ aiElapsedMs: Date.now() - started, tools: payload.choices?.[0]?.message?.tool_calls?.map(c => ({ name: c.function.name, candidates: c.function.name === 'price_menu_candidates' ? JSON.parse(c.function.arguments).candidates?.length : undefined })) }));
  }
  return response;
} });
const scenarios = [
  { id: 'full-menu', text: '所选门店，1人40元内，跨全菜单考虑套餐、随心配、小食组合，不限汉堡，给3种不同搭配。只查询不下单。', optionCount: 3 },
  { id: 'snacks-coke', text: '所选门店，1人40元内，不想吃汉堡，只想吃小吃，不喝纯悦，只喝普通可乐。综合所有符合条件的套餐和小食组合，给5种不同搭配。只查询不下单。', optionCount: 5 },
  { id: 'snacks-no-drink', text: '同一家门店，1人30元以内，只吃小食，不要汉堡，不要任何饮料，给3种不同组合。只查询不下单。', optionCount: 3 }
];
const reports = [];
for (const scenario of scenarios.filter(s => !process.env.SMOKE_SCENARIO || s.id === process.env.SMOKE_SCENARIO)) {
  console.log(JSON.stringify({ scenario: scenario.id, started: true }));
  const started = Date.now();
  try {
    const result = await agent.plan({ text: scenario.text, context: { fulfillment: 'pickup', location, budget: scenario.id === 'snacks-no-drink' ? 30 : 40, people: 1, optionCount: scenario.optionCount, maxCalories: null } });
    const report = { scenario: scenario.id, checkedAt: new Date().toISOString(), elapsedMs: Date.now() - started,
      message: result.message, coverage: result.menuCoverage, performance: result.performance,
      quotes: (result.quotes || []).map(q => ({ title: q.title, total: q.total, store: q.store?.name, lines: q.lines, composition: q.note, demo: q.demo, priceBasis: q.priceBasis })),
      orderAttempts: orders.attempts.size };
    reports.push(report); console.log(JSON.stringify(report));
    if (!report.quotes.length) process.exitCode = 1;
  } catch (error) {
    let message = String(error.message || 'Integration failed');
    for (const secret of [config.aiKey, config.mcdToken]) if (secret) message = message.split(secret).join('[REDACTED]');
    reports.push({ scenario: scenario.id, failed: true, error: message.slice(0, 500), elapsedMs: Date.now() - started });
    console.log(JSON.stringify(reports.at(-1))); process.exitCode = 1;
  }
  writeFileSync(new URL('../.runtime/menu-smoke-result.json', import.meta.url), JSON.stringify(reports, null, 2), { mode: 0o600 });
}
if (orders.attempts.size) throw new Error('Read-only integration must not create any orders');
