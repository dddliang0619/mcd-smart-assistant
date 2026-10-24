import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError, equalSecret, OrderService } from './domain.mjs';
import { McdClient } from './mcp.mjs';
import { OrderingAgent } from './agent.mjs';
import { checkInput, demoPlan } from './demo.mjs';
import { catalogMeta, listCatalog } from './catalog.mjs';
import { RecommendationService } from './recommend.mjs';
import { integrationStatus } from './integration.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function loadConfig(env = process.env) {
  const mode = env.APP_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('APP_MODE 必须是 demo 或 live。');
  const accessKey = env.APP_ACCESS_KEY || 'demo-local-only';
  if (mode === 'live' && (accessKey.length < 24 || /demo|change|example/i.test(accessKey))) throw new Error('真实模式需设置至少24位的随机 APP_ACCESS_KEY。');
  if (mode === 'live' && (!env.MCD_MCP_TOKEN || !env.AI_API_KEY)) throw new Error('真实模式需设置 MCD_MCP_TOKEN 和 AI_API_KEY。');
  const aiBaseUrl = env.AI_BASE_URL || 'https://api.deepseek.com';
  const parsed = new URL(aiBaseUrl);
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('AI 服务地址必须使用 HTTPS。');
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 无效。');
  return { mode, accessKey, host: env.HOST || '127.0.0.1', port, mcdToken: env.MCD_MCP_TOKEN, aiBaseUrl, aiModel: env.AI_MODEL || 'deepseek-flash', aiKey: env.AI_API_KEY };
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function readBody(req, limit = 40_000) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('请求必须是 JSON。', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new AppError('请求内容过大。', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('JSON 格式不正确。'); }
}
export function createApp({ config, mcp, directory = join(root, '.runtime'), fetchImpl } = {}) {
  mcp ||= new McdClient({ token: config.mcdToken });
  const orders = new OrderService({ mcp, directory, mode: config.mode });
  const agent = new OrderingAgent({ mcp, orders, config, fetchImpl });
  const recommender = new RecommendationService();
  let verification = null;
  const staticFiles = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      // Exact host validation also prevents DNS-rebinding access to the local API.
      const hostname = url.hostname;
      const allowedHost = ['127.0.0.1', 'localhost', '[::1]', config.host].includes(hostname) || (config.host === '0.0.0.0' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d/.test(hostname));
      if (!allowedHost) throw new AppError('主机地址不被允许。', 403);
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new AppError('不接受其他网页的跨域请求。', 403);
      if (req.method === 'GET' && staticFiles[url.pathname]) {
        const [file, type] = staticFiles[url.pathname];
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(await readFile(join(root, 'web', file))); return;
      }
      if (!url.pathname.startsWith('/api/')) throw new AppError('地址不存在。', 404);
      const authorization = req.headers.authorization || '';
      if (!equalSecret(authorization, `Bearer ${config.accessKey}`)) throw new AppError('连接口令不正确，请在连接设置中填写后端的 APP_ACCESS_KEY。', 401);
      if (req.method === 'GET' && url.pathname === '/api/health') {
        const integration = integrationStatus(config, verification);
        send(res, 200, { mode: config.mode, message: config.mode === 'demo' ? integration.summary + ' · 当前搭配为模拟价' : integration.summary, upstreamChecked: integration.upstreamChecked, integration, catalog: catalogMeta }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/catalog') {
        send(res, 200, listCatalog({ query: url.searchParams.get('q') || '', category: url.searchParams.get('category') || '',
          offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 30) })); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/integration') { send(res, 200, integrationStatus(config, verification)); return; }
      if (req.method === 'POST' && url.pathname === '/api/check') {
        if (!config.mcdToken) { send(res, 200, { message: '当前可体验预算搭配；配置麦当劳 MCP 凭证后即可核验官方接口。', integration: integrationStatus(config) }); return; }
        verification = null;
        const tools = await mcp.ready();
        verification = { tools, checkedAt: new Date().toISOString() };
        const integration = integrationStatus(config, verification);
        if (integration.missing.length) throw new AppError(`官方账号缺少接口：${integration.missing.join('、')}`, 503, { integration });
        send(res, 200, { message: config.mode === 'demo'
          ? '官方 MCP 连接及工具清单已核验。' + (config.aiKey ? '当前仍是演示模式，切换真实模式后联调官方配餐。' : '还需配置 AI 服务密钥，当前搭配仍是模拟价。')
          : '官方 MCP 工具清单已核验。生成搭配时将查询具体门店套餐、优惠并逐份核价；AI 服务将在配餐时验证。', integration }); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/plan') {
        const input = checkInput(await readBody(req));
        const result = config.mode === 'demo' ? demoPlan(input, orders, recommender) : await agent.plan(input);
        send(res, 200, result); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/confirm') {
        send(res, 200, await orders.confirm(await readBody(req))); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/orders') { send(res, 200, { orders: orders.list() }); return; }
      const match = /^\/api\/orders\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'POST' && match) { send(res, 200, await orders.refresh(match[1])); return; }
      throw new AppError('地址不存在或请求方法错误。', 404);
    } catch (error) {
      const known = error instanceof AppError;
      send(res, known ? error.status : 502, { error: known ? error.message : '服务调用未完成，请检查网络和后端配置；如已提交订单，请先到官方订单核实。', ...(known ? error.extra : {}) });
    }
  });
  server.requestTimeout = 240_000;
  server.headersTimeout = 15_000;
  return { server, orders };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`))) {
  try {
    const config = loadConfig();
    const { server } = createApp({ config });
    server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用，请关闭旧服务或修改 PORT。' : '服务启动失败。'); process.exitCode = 1; });
    server.listen(config.port, config.host, () => console.log(`点餐助手已启动：http://127.0.0.1:${config.port}\n运行模式：${config.mode === 'demo' ? '演示（不会真实下单）' : '真实'}\n微信开发者工具请导入项目根目录。`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
