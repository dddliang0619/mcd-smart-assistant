import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createApp } from '../server/index.mjs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../scripts/skill.mjs', import.meta.url));
function run(args, env, input) {
  return new Promise(resolve => {
    const child = execFile(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, timeout: 15_000 }, (error, stdout, stderr) => {
      resolve({ code: error?.code || 0, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

test('Skill CLI 完整演示：查询、配餐、拒绝未确认提交，再确认并查询同一订单', async () => {
  const { server, orders } = createApp({ config: { mode: 'demo', accessKey: 'skill-test-only', host: '127.0.0.1', port: 0 }, directory: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { MCD_ASSISTANT_URL: `http://127.0.0.1:${server.address().port}`, APP_ACCESS_KEY: 'skill-test-only' };
  try {
    const health = await run(['health'], env);
    assert.equal(health.code, 0);
    assert.equal(JSON.parse(health.stdout).mode, 'demo');
    const plan = await run(['plan', '--input', '-'], env, JSON.stringify({ text: '一个人吃，30元以内，无糖饮料', context: { fulfillment: 'pickup', location: '广州天河', budget: 30 } }));
    assert.equal(plan.code, 0);
    const quote = JSON.parse(plan.stdout).quotes[0];
    assert.equal(quote.priceBasis, 'simulated');
    assert.ok(Number(quote.total) <= 30);
    const body = JSON.stringify({ quoteId: quote.id, takeWayCode: quote.takeWays[0].code, confirmed: true });
    const denied = await run(['confirm', '--input', '-'], env, body);
    assert.equal(denied.code, 1);
    assert.match(denied.stderr, /user-confirmed/);
    assert.equal(orders.list().length, 0);
    const created = await run(['confirm', '--input', '-', '--user-confirmed'], env, body);
    assert.equal(created.code, 0);
    const record = JSON.parse(created.stdout);
    assert.equal(record.status, 'created');
    assert.match(record.order.orderId, /^DEMO-/);
    const listed = await run(['orders'], env);
    assert.equal(JSON.parse(listed.stdout).orders[0].quoteId, quote.id);
    const refreshed = await run(['refresh', '--quote-id', quote.id], env);
    assert.equal(JSON.parse(refreshed.stdout).order.orderId, record.order.orderId);
    const bad = await run(['confirm', '--input', '-', '--user-confirmed'], env, JSON.stringify({ quoteId: quote.id, confirmed: false }));
    assert.equal(bad.code, 1);
    assert.equal(orders.list().length, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Skill CLI 拒绝将后端口令发送到非本机目标', async () => {
  const result = await run(['health'], { MCD_ASSISTANT_URL: 'https://example.com', APP_ACCESS_KEY: 'private-test-value' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /本机/);
  assert.equal((result.stderr + result.stdout).includes('private-test-value'), false);
});

test('Skill CLI 保留 HTTP 409 的替代报价并返回失败退出码', async () => {
  const { createServer } = await import('node:http');
  const replacement = { error: '报价变化', quote: { id: 'replacement', total: '31.00' } };
  let calls = 0;
  const server = createServer((req, res) => { calls++; req.resume(); res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(replacement)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await run(['confirm', '--input', '-', '--user-confirmed'], { MCD_ASSISTANT_URL: `http://127.0.0.1:${server.address().port}` }, JSON.stringify({ quoteId: 'original', confirmed: true }));
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), replacement);
    assert.equal(calls, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
