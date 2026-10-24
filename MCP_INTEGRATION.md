# 麦当劳 MCP 接入说明

## Server 与实现

- 官方远程 Server：`https://mcp.mcd.cn`。
- 传输：Streamable HTTP；支持 JSON 和 SSE 响应。
- 鉴权：后端从 `MCD_MCP_TOKEN` 环境变量读取凭证，发送 `Authorization: Bearer …`。
- 代码：[`server/mcp.mjs`](server/mcp.mjs) 完成 `initialize`、`notifications/initialized`、分页 `tools/list` 与 `tools/call`，协商协议版本并保留会话 ID。
- Skill → [`scripts/skill.mjs`](scripts/skill.mjs) → 本机 HTTP 后端 → MCP。小程序和浏览器复用相同后端；真实配餐另需兼容工具调用的 AI 服务。

## 实际使用状态

2026-10-24 打包时，已使用现有个人凭证真实完成官方 MCP 初始化与工具清单读取，共返回 35 个工具，并成功调用只读 `now-time-info`。未提交任何真实订单。本次核验不保存 Token、会话 ID、账户数据或完整响应到公开仓库。

开发环境已提供本机 AI 连接配置，新版支持从 `.runtime/ai-provider.json` 优先读取服务地址、模型和密钥，并支持可选推理强度参数。配置更新后须重启运行中的后端；以 `health` 返回的模式及配置状态判断其是否加载，不能只看配置文件存在。以下配餐业务工具已接入源码并通过模拟测试，但真实 AI 配餐、官方业务计价和订单全流程仍需用个人环境联调。不要将配置齐全、工具开放或模拟测试通过称为真实点餐已完成。

| Tool | 代码中的作用 | 本次真实调用 |
| --- | --- | --- |
| `now-time-info` | AI 只读工具白名单中的当前时间查询 | 已成功调用 |
| `query-nearby-stores` | 根据位置查询自取门店 | 未在打包核验中调用 |
| `delivery-query-addresses` | 查询已有外送地址 | 未调用 |
| `delivery-query-stores` | 查询地址可配送门店 | 未调用 |
| `query-meals` | 获取门店在售菜单、商品及套餐编码 | 未调用 |
| `query-meal-detail` | 查询套餐组成与替换选项 | 未调用 |
| `query-store-coupons` / `query-my-coupons` | 查询已有可用优惠 | 未调用 |
| `calculate-price` | 每份方案官方核价、确认前再次核价 | 未调用 |
| `list-nutrition-foods` | 可用时提供官方营养参考 | 未调用 |
| `create-order` | 用户确认后由后端创建订单 | 未调用 |
| `query-order` | 刷新已有订单状态 | 未调用 |

## 业务调用流程

1. `POST /api/check` 调用 `McdClient.ready()` 核验会话和工具清单，不查询用户订单或创建订单。
2. 用户给出位置、就餐方式、总预算、人数及口味。`POST /api/plan` 在真实模式运行 `OrderingAgent`，只给 AI 提供只读白名单工具。
3. 自取走附近门店；外送走已有地址与可配送门店；随后查询门店套餐和菜单、套餐详情与已有优惠。编码必须来自官方响应。
4. 逐方案调用 `calculate-price`。后端校验门店、商品来源、官方明细和总预算，生成一至五个报价快照；通过 `present_plan` / `present_plans` 返回给界面或 Skill。
5. 用户选定并明确确认具体方案，`POST /api/confirm` 按服务端快照再次核价。价格或餐品变化时返回替代方案，让用户重新确认。
6. 后端校验 `create-order` 的实际输入 schema，再创建订单，保留提交状态。`query-order` 只刷新已存在的官方订单，支付由用户在官方渠道完成。

默认套餐通过本地只读工具 `price_default_meal` 简化核价：先校验商品来自所选门店菜单，再内部调用官方 `query-meal-detail`，只选择 `isDefault=1` 的子项并校验分组数量，最后调用 `calculate-price`。本地工具不是官方 MCP 新接口；缺少默认项、编码不符或数量不符时停止。替换、特调等硬性要求继续走完整详情和官方计价。

自取场景不向 AI 暴露外送地址工具。模型给出空的 `withOrder: {}` 时会移除；实际含购卡参数的对象仍会在核价前被拒绝。AI 限流、超时和网关异常均明确返回错误，不创建订单，也不回退模拟价。

## 业务价值与数据边界

将自然语言要求转成可比较的预算方案，用实际门店菜单和官方计价减少“推荐存在但门店不卖”或“优惠计算不适用”的问题。查询、确认和提交分离，避免仅因用户询价就创建订单。

广州参考目录仅帮助选择餐品，不能替代官方商品编码或实时售价。演示模式完全独立运行，明确返回模拟价和 `DEMO-` 订单。营养缺失保留为未知，严格饮食条件不能验证时不承诺满足。

金额按接口分别处理：官方 `calculate-price` 为整数分，订单详情的金额为元字符串。报价有效五分钟；同一报价重复确认复用提交记录。下单超时或返回结构不明时记为待核实，不自动重试，避免重复创建订单。

密钥只留在后端本地环境。公开示例仅含占位符；个人地址、订单记录、支付链接、会话响应、本机配置和日志均不纳入仓库。

## 验证方法

- `npm run check`：入口、页面与参赛文件是否齐全。
- `npm test`：预算与饮食边界、模拟 AI 工具调用、报价来源、再次核价、幂等及重启处理、Skill 请求到后端的完整演示流程。
- 配置个人环境后运行 `node --env-file-if-exists=.env scripts/skill.mjs check` 核验官方工具。该步骤不证明计价成功；仍需生成真实报价，只有用户确认后才可真实下单。
- `scripts/smoke-live.mjs` 需显式配置 `SMOKE_LOCATION`，可验证真实 AI 配餐只读流程；工具白名单拒绝创建订单和修改账户。此脚本会产生真实 AI 调用用量；诊断结果只留在私有 `.runtime/`，不作为公开材料自动上传。

官方参考：[MCP 接入指南](https://github.com/M-China/mcd-mcp-server) · [Token 申请入口](https://open.mcd.cn/mcp)
