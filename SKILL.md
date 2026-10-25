---
name: mcd-smart-assistant
description: 根据人数、总预算和口味推荐麦当劳餐品，查询小程序后端的产品资料与 MCP 接入状态，比较报价，并在用户确认具体方案后创建订单。用于麦当劳配餐、点餐及本项目微信小程序辅助操作。
---

# 麦麦智点餐

复用本仓库的小程序后端，提供自然语言配餐 Skill。脚本输出 JSON；读取结构化结果后向用户解释。所有命令均在本 Skill 目录执行，也可使用脚本绝对路径。

## 准备与状态

需要 Node.js 22.15+。先运行 `node --env-file-if-exists=.env scripts/skill.mjs health`，读取 `mode` 和 `integration`。没有后端时，参考 [README.md](README.md) 启动随附服务；不要覆盖用户已有的配置或启动第二个相同端口的服务。

- 演示模式不需要密钥，所有价格和订单必须明确称为“模拟”，不能声称查询到了门店实时价格。
- 真实模式需要后端的 `MCD_MCP_TOKEN`、AI 连接配置和随机 `APP_ACCESS_KEY`。AI 可从 `.env` 读取，也可从本机 `.runtime/ai-provider.json` 读取；本机配置优先。不要让用户把密钥贴进聊天或提交到仓库。
- 配置文件更新后需重启后端才会生效。区分“配置文件存在”和运行中 `health` 的 `aiConfigured`；不得把已有 Key 等同于已通过真实配餐验证。Windows 可用 `start-live.cmd` 启动真实模式；不要仅为检查连接擅自切换用户的运行模式。
- `check` 核验 MCP 工具清单；它不证明实时菜单、报价或下单已成功。真实配餐仍需 `plan` 的实际返回结果。

## 配餐与查询

收集总预算、人数、到店自取或外送及城市/附近地标；上下文已明确的不要重复询问。外送只用官方账号已有地址。详细入参、输出含义和命令见 [references/backend-api.md](references/backend-api.md)。

真实模式支持 `context.mealStyle`（`any`、`snacks`、`noBurger`）和 `context.drinkPreference`（`any`、`coke`、`sugarFreeCoke`、`none`）。只把用户明确提出的偏好填入对应字段；普通可乐、无糖可乐和不要饮料不能混用。要求冲突或官方可选子项无法满足时说明原因，不通过改方案标题来声称满足。

把请求写入临时 JSON 文件，再运行：

```bash
node --env-file-if-exists=.env scripts/skill.mjs plan --input request.json
```

示例请求见 [examples/plan.json](examples/plan.json)。用户未指定的硬性条件不要自行补充。展示返回的方案名称、门店、餐品数量、总价、配送费、优惠和取餐方式；以 `quotes` 数组为准，记录用户选中的 `id`。遇到问题返回或没有报价时解释缺少的信息，不编造餐品卡片。

`catalog` 是 2026-10-24 采集的广州参考资料，不等于当前门店在售菜单；未知营养值保持未知。口味、原料和过敏原推断不能作为严格饮食保证；真实模式尚不能保证逐规格热量限制。官方套餐组成、商品编码与价格以 MCP 返回为准，不承诺全局最低价。

真实模式的后端会用本地只读工具 `price_default_meal` 快捷核价普通套餐，仅使用官方明确标记的默认子项。它不是官方 MCP Tool，也不满足用户指定的替换或特调要求；有此类要求时必须按完整详情匹配。AI 限流、超时或网关错误时说明查询未完成，不回退成模拟价格来冒充真实报价。

新版另有本地只读工具 `price_menu_candidates`：从所选门店接口返回的完整菜单筛选候选，按详情校验实际组成并批量官方核价。`menuCoverage` 表示所选门店和时段的检索范围，不代表检索了全部城市门店或核价了每个菜单项；`performance` 仅用于解释本次耗时和查询次数。短时缓存不包含价格、地址或下单，确认前仍需再次计价。

## 用户确认后下单

“帮我推荐”“换一批”“查价格”仅授权查询。展示完整报价，并取得用户对具体餐品、门店、总价、就餐方式及取餐选项的明确下单确认后，才可生成确认请求：

```json
{"quoteId":"从选中方案读取的id","takeWayCode":"从该方案takeWays读取的code","confirmed":true}
```

外送无需 `takeWayCode`。执行：

```bash
node --env-file-if-exists=.env scripts/skill.mjs confirm --input confirmation.json --user-confirmed
```

脚本的 `--user-confirmed` 是防误调用开关，不代替用户授权。不要提前自动填写确认。后端会再次核价：HTTP 409 带有替代报价时，重新展示并取得确认；HTTP 410 说明报价过期。报价有效期为五分钟，后端重启会失效。

提交超时或返回 `unknown` / `submitting` 时，告知结果待核实，让用户检查官方订单；不要自动重试 `confirm` 或重新生成订单。`created` 仅代表创建成功，不代表支付成功。提供官方返回的支付链接，由用户自行完成支付。

## 订单与边界

`orders` 查看本后端近期记录；`refresh --quote-id ...` 查询其中一笔官方状态。只在用户要求时访问其订单，不将订单、地址或支付链接写入公开材料。

本 Skill 不购买会员卡、不消耗积分、不领券、不取消订单、不修改账号。参赛作品由开发者独立开发；餐品、售价、库存和状态以麦当劳官方渠道为准。
