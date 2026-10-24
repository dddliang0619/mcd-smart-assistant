// 静态自检：文件是否齐全、小程序页面是否配套、脚本引用是否存在。
// 用法：node scripts/check.mjs
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const problems = [];
const notes = [];

function check(relative, label) {
  const full = join(root, relative);
  if (!existsSync(full)) { problems.push(`缺少${label || '文件'}：${relative}`); return false; }
  return true;
}

function readJson(relative) {
  try { return JSON.parse(readFileSync(join(root, relative), 'utf8')); }
  catch (error) { problems.push(`JSON 读取失败：${relative}（${error.message}）`); return null; }
}

for (const file of ['package.json', 'project.config.json', '.env.example', 'README.md', '.gitignore',
  'SKILL.md', 'CONTEST_DECLARATION.md', 'MCP_INTEGRATION.md', 'mcp-config.example.json',
  'scripts/skill.mjs', 'references/backend-api.md', 'examples/plan.json']) {
  check(file);
}
for (const file of ['server/catalog.mjs', 'server/recommend.mjs', 'server/demo-prices.mjs', 'server/data/guangzhou-catalog.json']) check(file, '广州产品配餐模块');
check('server/integration.mjs', '麦当劳官方MCP接入模块');
check('server/default-meal.mjs', '官方默认套餐核价模块');
check('start-live.cmd', 'Windows真实模式启动入口');

const pkg = readJson('package.json');
if (pkg) {
  for (const [name, command] of Object.entries(pkg.scripts || {})) {
    const target = /node\s+(?:--[\w-]+\s+\S+\s+)?(\S+\.mjs)/.exec(command);
    if (target && !check(target[1], `npm run ${name} 用到的脚本`)) notes.push(`脚本 ${name}：${command}`);
  }
}

// 小程序：app.json 里登记的页面必须有 js/json/wxml/wxss 四件套。
const appJson = readJson('miniprogram/app.json');
if (appJson) {
  for (const page of appJson.pages || []) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) check(`miniprogram/${page}.${ext}`, '小程序页面文件');
  }
  for (const item of (appJson.tabBar && appJson.tabBar.list) || []) {
    if (!(appJson.pages || []).includes(item.pagePath)) problems.push(`tabBar 指向未登记的页面：${item.pagePath}`);
  }
}
for (const file of ['miniprogram/app.js', 'miniprogram/app.wxss', 'miniprogram/sitemap.json', 'miniprogram/config.js', 'miniprogram/utils/api.js']) {
  check(file, '小程序基础文件');
}

// 后端静态页三件套由 server/index.mjs 直接引用。
const serverIndex = join(root, 'server', 'index.mjs');
if (existsSync(serverIndex)) {
  const source = readFileSync(serverIndex, 'utf8');
  for (const name of source.matchAll(/'([\w.-]+\.(?:html|js|css))',\s*'[\w/;= -]+'/g)) {
    const file = name[1];
    if (['index.html', 'app.js', 'styles.css'].includes(file)) check(`web/${file}`, '调试页文件');
  }
} else {
  problems.push('缺少后端入口：server/index.mjs');
}

const pagesDir = join(root, 'miniprogram', 'pages');
if (existsSync(pagesDir)) {
  const declared = new Set((appJson && appJson.pages) || []);
  for (const name of readdirSync(pagesDir)) {
    if (!declared.has(`pages/${name}/${name}`) && !declared.has(`pages/${name}/index`)) {
      notes.push(`目录 miniprogram/pages/${name} 没有登记在 app.json（可能是没用到的页面）`);
    }
  }
}

if (problems.length) {
  console.error('自检没通过：');
  for (const item of problems) console.error('  ✗ ' + item);
  process.exitCode = 1;
} else {
  console.log('自检通过：后端、小程序、调试页文件齐全。');
}
for (const item of notes) console.log('  · ' + item);
