#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const HELP = `麦麦智点餐 Skill（Node.js 22.15+）
node --env-file-if-exists=.env scripts/skill.mjs <command> [options]

health                         读取运行模式和连接状态
integration                    读取 MCP 配置与核验状态
check                          核验 MCP 工具清单（不下单）
catalog [--query 文本] [--category 分类] [--limit 30] [--offset 0]
plan --input request.json       生成配餐报价；--input - 从标准输入读 JSON
confirm --input confirm.json --user-confirmed
                               仅在用户核对具体方案并确认下单后执行
orders                         查询本后端的订单记录
refresh --quote-id 报价编号     刷新一笔订单的官方状态

环境变量：MCD_ASSISTANT_URL（默认 http://127.0.0.1:8787）、APP_ACCESS_KEY。
仅连接本机后端；密钥从环境读取，不接受命令行密钥参数。演示默认口令为 demo-local-only。
JSON 原样输出；HTTP 错误也保留响应 JSON（包括替代报价），退出码为 1。
下单请求不自动重试；超时需先在官方渠道核实。`;

function parse(argv) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (Object.hasOwn(options, key)) throw new Error(`重复参数：${key}`);
    if (key === '--user-confirmed') options[key] = true;
    else if (['--input', '--query', '--category', '--limit', '--offset', '--quote-id'].includes(key)) {
      if (!rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(`参数缺少值：${key}`);
      options[key] = rest[++i];
    } else throw new Error(`未知参数：${key}`);
  }
  return { command, options };
}

async function inputJson(path) {
  if (!path) throw new Error('请用 --input 指定 JSON 文件，或用 --input - 从标准输入读取。');
  const text = path === '-' ? await readStdin() : await readFile(path, 'utf8');
  const body = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求必须是 JSON 对象。');
  return body;
}

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 40_000) throw new Error('请求内容超过 40KB。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const { command, options } = parse(process.argv.slice(2));
  if (['help', '--help', '-h'].includes(command)) { console.log(HELP); return; }
  const allowed = {
    health: [], integration: [], check: [], orders: [],
    catalog: ['--query', '--category', '--limit', '--offset'],
    plan: ['--input'], confirm: ['--input', '--user-confirmed'], refresh: ['--quote-id']
  };
  if (!Object.hasOwn(allowed, command)) throw new Error('未知命令，请运行 help。');
  for (const key of Object.keys(options)) if (!allowed[command].includes(key)) throw new Error(`${command} 不支持 ${key}。`);
  if (command === 'confirm' && options['--user-confirmed'] !== true) {
    throw new Error('尚未提供 --user-confirmed。须先向用户展示具体方案并取得下单确认；未发送任何请求。');
  }
  const base = new URL(process.env.MCD_ASSISTANT_URL || 'http://127.0.0.1:8787');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)
    || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('MCD_ASSISTANT_URL 只能是本机后端的 HTTP(S) 根地址。');
  }
  let path = `/api/${command}`;
  let body;
  if (command === 'check') body = {};
  if (['plan', 'confirm'].includes(command)) body = await inputJson(options['--input']);
  if (command === 'confirm' && (body.confirmed !== true || typeof body.quoteId !== 'string' || !body.quoteId)) {
    throw new Error('确认请求必须包含报价 quoteId 和 confirmed: true。');
  }
  if (command === 'catalog') {
    const query = new URLSearchParams();
    for (const [flag, name] of [['--query', 'q'], ['--category', 'category'], ['--limit', 'limit'], ['--offset', 'offset']]) {
      if (options[flag] !== undefined) query.set(name, options[flag]);
    }
    path += `?${query}`;
  }
  if (command === 'refresh') {
    if (!/^[\w-]+$/.test(options['--quote-id'] || '')) throw new Error('请提供有效的 --quote-id。');
    path = `/api/orders/${encodeURIComponent(options['--quote-id'])}`;
    body = {};
  }
  const response = await fetch(new URL(path, base), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.APP_ACCESS_KEY || 'demo-local-only'}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error', signal: AbortSignal.timeout(240_000)
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch(error => {
  const message = ['TimeoutError', 'AbortError'].includes(error.name)
    ? '请求超时；如果调用的是 confirm，先到麦当劳官方订单核实，勿自动重试。'
    : error.message === 'fetch failed' ? '无法连接本机后端，请检查服务和 MCD_ASSISTANT_URL；若已提交下单，请先核实官方订单。' : error.message;
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
