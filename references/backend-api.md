# 后端调用参考

命令默认连接 `http://127.0.0.1:8787`。使用 `node --env-file-if-exists=.env scripts/skill.mjs ...`，从当前目录 `.env` 载入访问口令。也可通过 `MCD_ASSISTANT_URL` 指向同机其他端口。

| 命令 | 后端接口 | 主要输出 |
| --- | --- | --- |
| `health` | GET `/api/health` | `mode`、`integration`、参考目录元数据 |
| `integration` | GET `/api/integration` | `mcpConfigured`、`aiConfigured`、`upstreamChecked`、`features` |
| `check` | POST `/api/check` | MCP 工具清单核验结果，不创建订单 |
| `catalog --query 无糖 --limit 30` | GET `/api/catalog` | `products` 及历史参考资料说明 |
| `plan --input request.json` | POST `/api/plan` | `quotes`、兼容字段 `quote` 或补充信息提示 |
| `confirm --input confirm.json --user-confirmed` | POST `/api/confirm` | 创建结果或替代报价 |
| `orders` | GET `/api/orders` | 此后端近期订单，不是全账号历史 |
| `refresh --quote-id ...` | POST `/api/orders/{quoteId}` | 指定记录的最新状态 |

## 配餐请求

```json
{
  "text": "一个人吃，30元以内，不吃辣，想要汉堡和无糖饮料",
  "context": {
    "fulfillment": "pickup",
    "location": "广州天河区",
    "budget": 30,
    "people": 1,
    "optionCount": 3,
    "mealPeriod": "regular"
  }
}
```

- `fulfillment` 必须为 `pickup` 或 `delivery`；预算为所有人的人民币总预算，外送含配送费。
- `text` 为 1–2000 字；`location` 最多 300 字，真实模式需提供位置线索。预算大于 0 且不超过 2000，可为 `null` 让程序从文本解析或补问。
- `people` 为 1–8，`optionCount` 为 1–5；`mealPeriod` 为 `regular`、`breakfast` 或 `all`。
- 真实模式可传 `mealStyle`（`any`、`snacks`、`noBurger`）和 `drinkPreference`（`any`、`coke`、`sugarFreeCoke`、`none`），不传默认为不限。小程序的对应按钮只在真实模式参与请求；演示模式不保证这些新增结构化偏好。
- `history` 可选，最多 20 条 `user` / `assistant` 文本记录，用于保留必要澄清内容。
- `requiredProducts` 是本地参考产品 ID，不能当成官方商品编码下单。
- `maxCalories` 是整份方案的参考热量上限，仅演示模式能用本地已知数据筛选；真实模式不能保证满足。

## 报价与确认

每个 `quotes[]` 含 `id`、`expiresAt`、`demo`、`priceBasis`、`title`、`store`、`destination`、`lines`、`total`、`delivery`、`discount` 和 `takeWays`。显示人民币金额字段即可，不要再次除以 100。报价仅在生成它的后端进程内有效。

真实配餐还可能返回 `menuCoverage`（门店、接口菜单项目数、已检查详情数和核价候选数）及 `performance`（耗时、AI 轮数、官方调用数、缓存命中数）。展示时保留门店和时段范围，不把“读取完整接口菜单”说成“每一项都已核价”或“全城最低价”。

自取确认从所选报价读取 `takeWays[].code`；外送不必传取餐方式：

```json
{"quoteId":"所选报价的id","takeWayCode":"该报价中的code","confirmed":true}
```

- HTTP 409 若含 `quote`：价格或内容已变，重新展示并让用户确认新的报价。
- HTTP 410：五分钟有效期已过，重新配餐并重新确认。
- `status: created`：仅创建订单成功。演示单号以 `DEMO-` 开头。
- `status: unknown` / `submitting`，或提交超时：停止自动下单，提醒用户到官方渠道核实。
- 只显示官方返回的取餐码和 `order.payUrl`，不自行生成；由用户在官方渠道支付。

脚本保留后端错误 JSON，进程以非零状态退出。不要把非零退出码当作“订单一定没创建”，也不要因脚本没有成功退出而自动重试。
