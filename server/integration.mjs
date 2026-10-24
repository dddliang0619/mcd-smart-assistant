const capabilities = [
  { id: 'pickup', name: '附近自取门店', tools: ['query-nearby-stores'] },
  { id: 'delivery', name: '外送地址与门店', tools: ['delivery-query-addresses', 'delivery-query-stores'] },
  { id: 'menu', name: '门店在售餐品与套餐', tools: ['query-meals'] },
  { id: 'details', name: '套餐组成与可替换选项', tools: ['query-meal-detail'] },
  { id: 'coupons', name: '门店可用优惠', tools: ['query-store-coupons'] },
  { id: 'pricing', name: '优惠后总价与配送费', tools: ['calculate-price'] },
  { id: 'ordering', name: '确认后创建订单', tools: ['create-order'] },
  { id: 'orders', name: '查询官方订单状态', tools: ['query-order'] }
];

export function integrationStatus(config, verification = null) {
  const checked = !!verification;
  const names = new Set(verification?.tools.map(t => t.name) || []);
  const features = capabilities.map(c => ({ ...c, available: checked ? c.tools.every(name => names.has(name)) : null,
    statusText: checked ? (c.tools.every(name => names.has(name)) ? '工具已开放' : '缺少接口权限') : '待连接核验' }));
  const mcpConfigured = !!config.mcdToken;
  const aiConfigured = !!config.aiKey;
  const ready = checked && features.every(f => f.available);
  const state = config.mode === 'demo'
    ? checked ? (ready ? 'demo_connected' : 'demo_partial') : mcpConfigured ? 'demo_configured' : 'demo'
    : !mcpConfigured || !aiConfigured ? 'waiting_config' : !checked ? 'not_checked' : ready ? 'ready' : 'partial';
  const summary = { demo: '演示模式 · 官方 MCP 尚未启用', waiting_config: '官方接入配置待补齐', not_checked: '已配置密钥 · 等待连接核验',
    demo_configured: 'MCP 凭证已配置 · 等待连接核验', demo_connected: '官方 MCP 已核验 · 配餐仍为演示模式', demo_partial: '官方 MCP 部分接口未开放 · 配餐仍为演示模式',
    ready: '官方 MCP 工具清单已核验', partial: '官方 MCP 已连接 · 部分接口未开放' }[state];
  return { provider: '麦当劳官方 MCP', state, summary, mode: config.mode, mcpConfigured, aiConfigured,
    upstreamChecked: checked, checkedAt: verification?.checkedAt || null, features,
    missing: checked ? features.flatMap(f => f.tools.filter(name => !names.has(name))) : [],
    nextStep: !mcpConfigured ? '配置麦当劳 MCP 凭证' : !checked ? '检查官方 MCP 接入' : !aiConfigured ? '配置 DeepSeek 等 AI 服务密钥，验证后启用真实配餐' : config.mode === 'demo' ? '切换真实模式并验证 AI 配餐' : '可查询门店并逐份官方核价',
    notice: '工具清单核验不代表已取得当前门店菜单或价格。真实方案逐份调用官方计价；仅覆盖官方接口对当前账号、门店和时段开放的数据。' };
}
