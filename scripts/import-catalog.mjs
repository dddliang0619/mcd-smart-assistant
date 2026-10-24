// Re-import the collected JSON without flattening serving sizes or replacing nulls.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

if (!process.argv[2]) throw new Error('请传入采集 JSON 路径：node scripts/import-catalog.mjs <文件路径>。随仓库提供的资料已可直接使用。');
const source = resolve(process.argv[2]);
const raw = readFileSync(source);
const rows = JSON.parse(raw);
if (!Array.isArray(rows) || !rows.length || rows.some(r => !r.record_id || !r.product_id || !r.product_name || !r.category || !r.serving_label)) throw new Error('产品资料字段不完整，未导入。');
if (new Set(rows.map(r => r.record_id)).size !== rows.length) throw new Error('规格 record_id 重复，未导入。');
const metadata = { region: '广州', collectedOn: [...new Set(rows.map(r => r.collected_on))].sort().at(-1),
  productCount: new Set(rows.map(r => r.product_id)).size, variantCount: rows.length,
  source: process.argv[2] ? '用户提供的采集JSON' : 'outputs/mcd-guangzhou-20261024/processed_data.json',
  sourceSha256: createHash('sha256').update(raw).digest('hex'), storeVerified: false, priceStatus: 'not_collected',
  notice: '官网资料及活动资料汇总，广州具体门店供应与售价未核验；口味、主料和过敏原部分为推断。' };
writeFileSync(new URL('../server/data/guangzhou-catalog.json', import.meta.url), JSON.stringify({ metadata, rows }, null, 2) + '\n');
console.log(`已导入 ${metadata.productCount} 款产品 / ${metadata.variantCount} 条规格；原始缺失字段及来源已保留。`);
