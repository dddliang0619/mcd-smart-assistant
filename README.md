# 麦麦智点餐 · mcd-smart-assistant

**一句话说需求，按人数和总预算比较麦当劳搭配，核对后再下单。**

由个人微信小程序改造而来，提供可导入的 Skill、微信小程序和浏览器界面，共用一个 Node.js 后端。面向希望按预算选餐、比较多种搭配的个人用户。

> 本项目为麦当劳程序员创意开发大赛参赛作品，由开发者独立开发，非麦当劳官方产品。默认演示模式使用模拟价，不会真实下单。餐品、售价和供应以官方渠道为准，营养资料仅供参考。

## 功能

- 按总预算、人数、餐段和常见口味条件推荐 1–5 种不同组合，支持换一批。
- 内置广州 104 款餐品、147 条规格参考资料，保留来源、采集日期及缺失值。
- 真实模式查询官方门店、套餐详情、已有优惠和实际总价；本地参考 ID 不能用于官方下单。
- 确认下单前再次核价；报价变化后重新确认；重复确认复用原记录，提交结果不明时停止自动重试。
- Skill 和小程序都能查询连接状态、报价和订单；付款由用户在官方渠道完成。

## 安装和启动

需要 **Node.js 22.15 或更高版本**。运行代码只使用 Node.js 内置模块，无需 `npm install`。

```bash
git clone https://github.com/dddliang0619/mcd-smart-assistant.git
cd mcd-smart-assistant
node --env-file-if-exists=.env server/index.mjs
```

默认 `http://127.0.0.1:8787`，演示口令为 `demo-local-only`。浏览器打开该地址，输入口令即可配餐。也可使用 `npm start`；Windows 可双击 `start.cmd`。

首次体验无需 `.env`。自定义配置时，将 `.env.example` 复制为 `.env` 后在本地填写；该文件不会提交。

## 导入 Skill

仓库根目录就是完整 Skill 目录：入口为 [`SKILL.md`](SKILL.md)，包含执行脚本、后端和参考资料。

1. 将整个仓库文件夹以 `mcd-smart-assistant` 为目录名，放入客户端支持的本地技能目录，或用客户端的本地技能导入功能选择这个文件夹。仅复制 `SKILL.md` 不足以运行。
2. 在该目录启动上面的后端。若客户端已加载技能但尚未启动后端，可按技能指引启动服务。
3. 在支持技能调用的客户端输入：

   > 使用 mcd-smart-assistant，帮我在广州天河区搭配一个人吃的麦当劳，30元以内，想要汉堡和无糖饮料。先给我几份方案。

4. 也可不依赖客户端，直接运行 Skill 脚本：

```bash
node --env-file-if-exists=.env scripts/skill.mjs health
node --env-file-if-exists=.env scripts/skill.mjs catalog --query 无糖
node --env-file-if-exists=.env scripts/skill.mjs plan --input examples/plan.json
```

脚本返回 JSON。演示输出带有 `demo: true` 和 `priceBasis: simulated`，只能作为模拟报价。命令、确认请求和结果解释见 [`references/backend-api.md`](references/backend-api.md)。

用户核对具体报价并明确确认后，才能调用 `confirm --input confirmation.json --user-confirmed`。不要把“推荐套餐”当作下单授权。

## 微信小程序

1. 用微信开发者工具导入本仓库根目录；`project.config.json` 指向 `miniprogram/`，默认使用测试 AppID。
2. 本地调试时在开发者工具中允许本地 HTTP 地址。
3. 小程序“连接设置”填写后端地址 `http://127.0.0.1:8787` 和同一访问口令。
4. 输入需求 → 比较方案 → 选择方案 → 核对餐品、总价和取餐方式 → 确认下单 → 查询状态。

手机调试需要手机可达的后端地址，并单独配置网络；生产发布需要符合微信要求的 HTTPS 域名。仓库不包含个人 AppID、本机局域网配置或凭证。

## 真实 MCP 接入

1. 从 [麦当劳 MCP 平台](https://open.mcd.cn/mcp) 申请个人 Token。
2. 复制 `.env.example` 为 `.env`，在后端本地填入 `MCD_MCP_TOKEN`、支持工具调用的 `AI_API_KEY`，并设置至少 24 位的随机 `APP_ACCESS_KEY`。
3. 配置 `AI_BASE_URL` 和 `AI_MODEL`。默认适配 DeepSeek 的 Chat Completions 工具调用格式；其他服务需支持兼容协议和工具调用。
4. 设置 `APP_MODE=live` 后重启。先运行 `check`，再用真实位置生成方案验证菜单与计价。

```bash
node --env-file-if-exists=.env scripts/skill.mjs check
```

[`mcp-config.example.json`](mcp-config.example.json) 是客户端直连 MCP 的脱敏示例，`${MCD_MCP_TOKEN}` 为环境变量占位符。各客户端的变量插值语法可能不同，需要按客户端配置；后端直接读取 `.env`，不加载此示例文件。

**当前验证情况（2026-10-24）：** 已使用本机个人凭证完成官方 MCP 会话初始化，读取到 35 个工具，并成功调用只读的 `now-time-info`。本机 AI 密钥尚未配置；真实 AI 配餐、官方计价和创建订单未在本次打包中完成端到端实测。自动化测试中的真实模式使用模拟 MCP/AI，不能代替线上验证。公开仓库只包含脱敏配置。

实际工具、调用流程和业务价值见 [`MCP_INTEGRATION.md`](MCP_INTEGRATION.md)。

## 项目结构

```text
SKILL.md                       Skill 入口
scripts/skill.mjs               Skill 命令行适配器
references/backend-api.md       请求与输出说明
examples/plan.json              可直接运行的演示请求
server/                        MCP、AI 配餐、计价验证和订单状态机
server/data/                   带来源的广州参考目录
data/catalog-source.json       公开餐品资料的采集原始副本
miniprogram/                   微信小程序
web/                           浏览器体验界面
test/                          预算、订单、AI/MCP 模拟及 Skill 测试
CONTEST_DECLARATION.md          官方原样参赛声明
MCP_INTEGRATION.md              MCP 接入说明
mcp-config.example.json        脱敏 MCP 配置
```

## 资料与限制

参考资料采集于 2026-10-24；营养来源日期保留在各规格中。它不是实时菜单，包含 23 条热量缺失记录。未知营养值不会按零处理，推断的口味和过敏原信息会标注，不能用于医疗或严格过敏饮食判断。真实模式尚不能逐规格验证营养限制。

只使用账号已有地址及优惠券；不买会员、不用积分、不领券、不修改账号。当前界面仅做麦当劳官方点餐，不含跨平台价格比较。每次报价有效五分钟，重启后需重新生成。

原始产品资料及官方来源链接在 `data/catalog-source.json`；运行目录自带导入副本。更新数据可运行 `node scripts/import-catalog.mjs 新资料.json`，请保留原始字段与来源。

## 检查

```bash
npm run check
npm test
```

测试不会真实创建订单。`.env`、本机配置、`.runtime/`、日志及订单数据均已排除。未提供 `workbuddy.md`：未核验的 WorkBuddy 开发经历不作声明。

参考：[官方比赛仓库](https://github.com/M-China/mcd-developer-innovation-challenge) · [官方 MCP 指南](https://github.com/M-China/mcd-mcp-server)
