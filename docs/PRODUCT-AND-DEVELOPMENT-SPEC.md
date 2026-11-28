# QIANYUSHI LTL V2 产品与开发规格

文档版本：1.0  
项目阶段：可运行 MVP / 沙盒验收阶段  
公司：Shenzhen Qianyushi Supply Chain Service Co., Ltd.  
最后整理日期：2026-09-13

## 1. 文档目的

本文档是当前代码的产品、业务和技术基线，用于：

- 后续开发人员快速理解系统。
- 判断功能是否符合当前约定。
- 数据库重建、环境迁移和部署。
- 承运商 API 联调与故障定位。
- 防止未来开发重新加入当前明确不需要的复杂流程。

本文档描述的是已经实现或已经明确约定的行为。标记为“限制”或“后续”的内容不能理解成已完成。

## 2. 产品定位

QIANYUSHI LTL V2 是面向美国 LTL 运输的轻量客户自助平台。核心目标只有四个：

1. 客户快速填写或粘贴运输资料。
2. 系统从 WWEX、Priority1、TQL 获取多承运商报价；Mothership 当前仅用于比价。
3. 客户或操作人员保存报价并生成 BOL，同时预约 Pickup。
4. 通过预存押金控制客户是否可以出单，并记录扣款或退款。

当前版本避免建设完整 TMS，不处理运输完成后的跟踪、回单、发票或追加账单。

## 3. 当前范围

### 3.1 包含

- 登录与角色权限。
- 客户公司管理。
- 客户登录用户管理。
- 初始化/重置用户密码。
- 中英文 UI。
- Smart Quote 文本解析。
- ZIP Code、州、城市联动。
- Freight Details 和自动 Class。
- Accessorial Services。
- Priority1 与 WWEX 实时报价。
- 客户加价。
- Quote 保存。
- Sender/Receiver 联系资料。
- Address Book。
- BOL 生成。
- Pickup 预约。
- Void 与 Pickup/Shipment 取消。
- 押金充值、调整、扣款、释放和退款记录。
- Orders 与 Quote 历史查询。
- 平台基础 Settings。
- Help 简要说明。

### 3.2 不包含

- Carrier Label。
- Tracking 状态时间线。
- POD 下载。
- Invoice。
- Rebill、Reweigh、Reclass 或 Adjustment 申诉。
- 邮件通知或短信通知。
- 客户在线支付或信用卡充值。
- 自动对账。
- 生产 API 账号切换向导。
- 完整危险品申报和危险品 BOL。
- Rate 有效期主动检查。
- 地址标准化或商业地址权威验证服务。

## 4. 用户角色与权限

### 4.1 Administrator

- 查看和操作客户数据。
- 切换当前操作客户。
- 创建、修改、停用或在允许条件下删除客户。
- 创建、修改、停用或删除登录用户。
- 初始化用户密码。
- 为客户增加或减少押金。
- 修改平台 Settings。
- 报价、保存 Quote、生成 BOL、Void Shipment。

### 4.2 Operations

Operations 为所属客户内的操作角色，不具有总管理员接口权限，也不能切换其他客户。跨客户管理只允许 Admin。

### 4.3 Sales

- 登录系统。
- 在自己的客户上下文内使用业务功能。
- 不具备客户、用户和平台管理权限。

### 4.4 Customer

- 只能访问其所属客户的数据。
- 可新建报价、保存 Quote、查看 Orders/Deposit/Address Book。
- 只有客户 `can_self_book=true` 时才能 Generate BOL。

### 4.5 数据隔离规则

- `saved_quotes`、`address_book`、`deposit_accounts` 和 `deposit_transactions` 按 `customer_id` 隔离。
- 普通客户会话始终绑定自己的客户。
- Admin 可以通过安全 Cookie 选择另一个有效客户。
- 服务端查询必须使用当前会话的 `customer_id` 过滤，不能依赖浏览器提交的客户 ID。

## 5. 核心业务流程

### 5.1 报价流程

```text
输入路线/日期/货物/附加服务
          ↓
校验 ZIP、日期和货物数值
          ↓
并行请求 WWEX 与 Priority1
          ↓
每个渠道保留最低 5 个报价
          ↓
套用当前客户加价规则
          ↓
合并并按客户价升序显示
          ↓
用户选择一个 Rate
```

单个渠道失败时，另一个渠道仍可正常显示结果。只有两个渠道均无有效价格时，接口才返回“没有报价”。

### 5.2 保存 Quote

1. 用户选择 Rate。
2. 点击 Continue to Booking。
3. 填写 Sender、Receiver、发货日期、Pickup 时间和 Reference/PO。
4. 可选择把 Sender/Receiver 保存至 Address Book。
5. 点击 Save Booking Details。
6. 数据以 `draft` 状态保存到 `saved_quotes`。

保存 Quote 不扣押金，也不提交承运商。

### 5.3 Generate BOL

```text
draft Quote
    ↓ reserve_quote_for_bol
校验可用押金并原子扣款，Quote → booking
    ↓
提交 WWEX 或 Priority1
    ↓
生成 Shipment + BOL + Pickup
    ↓ complete_quote_bol
保存承运商编号，Quote → booked
```

如果承运商提交失败且没有创建运单：

- 调用 `release_quote_bol_reservation`。
- 押金退回。
- Quote 恢复为 `draft`。

如果承运商可能已经创建运单，但本地数据库最终写入失败：

- 系统不能盲目退款或重新提交。
- API 返回明确警告，要求先向承运商核对。
- Priority1 下一次操作前会先按 Reference 查重。

### 5.4 Void Shipment

```text
booked Shipment
    ↓
先调用承运商取消接口
    ↓ 只有承运商确认成功
void_quote_and_refund
    ↓
Quote → void，押金原额退回
```

关键原则：承运商取消失败时，不允许仅在本地把订单设为 Void，也不能退款，以免出现“运输仍有效但资金已退”的错误。

## 6. 页面和模块规格

### 6.1 登录/首次管理员

- 当数据库尚无 `app_users` 表时，系统可进入兼容模式。
- 当表已存在但无用户时，显示首次管理员创建表单。
- 密码最少 8 个字符。
- 登录使用 Supabase Auth。
- Access Token 和 Refresh Token 保存于 HttpOnly Cookie。
- 退出会清除登录和当前客户 Cookie。

### 6.2 New Quote

页面自上而下为：

1. 可用押金。
2. Smart Quote。
3. Route。
4. Freight Details。
5. Additional Services。
6. Get Rates。
7. Rate Results。
8. Booking Details。

### 6.3 Route

字段：

- Ship From ZIP。
- Ship To ZIP。
- Ready Date。
- Flexible Date。
- 起运地/目的地 Address Book 按钮。

布局要求：Ship From、Ship To 和 Ready Date 同一行并保持统一高度；窄屏可响应式换行。

ZIP Code 为 5 位数字。输入完成后，前端调用 `/api/locations/[zip]`：

- 自动填州。
- 自动选择返回列表中的第一个城市。
- 如果 ZIP 对应多个城市，City 使用下拉菜单允许人工选择。

ZIP/City 数据来自项目内 `src/data/us-postal-cities.json`，不是实时 USPS 地址验证。

### 6.4 Smart Quote

输入约定：

- 第一行：发货地址。
- 第二行：收货地址。
- 第三行及以后：每行一个货物项目。

示例：

```text
Commercial loading dock, 24300 Nandina Ave, Moreno Valley, CA 92551
Residential liftgate appointment, 650 Boulder Drive, Breinigsville, PA 18031
1 pallet, 110×96×65cm, 177kg, commodity: Furniture
1 crate, 120×100×180cm, 500kg, non-stackable, commodity: Electronics
```

识别目标：

- 地址、City、State、ZIP。
- Commercial/商业。
- Residential/住宅/家庭。
- Loading dock/卸货平台。
- Liftgate/尾门。
- Appointment/预约。
- Pallet、Carton、Crate、Bale、Roll、Loose。
- 托数或件数。
- `L×W×H` 尺寸。
- kg/lb 与 cm/in。
- Stackable/Non-stackable。
- Commodity。

单位换算：

- `inch = cm / 2.54`
- `lb = kg × 2.2046226218`
- 填入表单前四舍五入为整数。

解析失败时应保留原输入，给出可理解的提示，不能静默生成明显错误数据。

### 6.5 Freight Details

每一行字段顺序：

1. Remove（位于 Line 标题下方最前面；只有多于一行时可删除）。
2. Packaging。
3. Stackable。
4. Pallets。
5. Length。
6. Width。
7. Height。
8. Unit Weight。
9. Total Weight。
10. Class。
11. Hazmat。
12. Commodity。
13. Declared Value。

允许包装类型：

- Carton
- Crate
- Bale
- Roll
- Pallet
- Loose

单位固定：

- Length/Width/Height：inch。
- Unit Weight/Total Weight：lb。
- Declared Value：USD。

自动计算：

- `Total Weight = Pallets × Unit Weight`
- Total Weight 只读。
- Freight Class 根据所有托盘合计密度估算，只读。

密度基本计算：

```text
单托立方英尺 = Length × Width × Height / 1728
总立方英尺 = 单托立方英尺 × Pallets
密度 = Total Weight / 总立方英尺
```

Class 使用 NMFC 常见 13 档密度估算。该结果只是报价输入辅助；特殊积载、责任、价值、NMFC Item 或承运商审计可能改变最终 Class。

危险品：

- 表单可记录 Hazmat。
- 报价适配器会把危险品标志发送给支持的渠道。
- 当前 Generate BOL 明确拒绝危险品，因为尚未收集 UN Number、Proper Shipping Name、Hazard Class 和 Packing Group。

### 6.6 Additional Services

当前 UI 项目：

- Liftgate at pickup
- Liftgate at delivery
- Residential pickup
- Residential delivery
- Limited access
- Appointment delivery
- Overlength freight

当前适配差异：

| 服务 | Priority1 | WWEX |
|---|---|---|
| Pickup Liftgate | 已映射 `LGPU` | 已映射 |
| Delivery Liftgate | 已映射 `LGDEL` | 已映射 |
| Residential Pickup | 已映射 `RESPU` | 已映射 |
| Residential Delivery | 已映射 `RESDEL` | 已映射 |
| Appointment Delivery | 已映射 `APPT` | 已映射 |
| Limited Access | 已映射派送 `LTDDEL` | 作为目的地 Location Type 映射 |
| Overlength | 当前未映射 | 当前未映射 |

未映射的服务不能被视为已进入承运商计价；生产上线前必须根据每个平台正式文档补齐。

### 6.7 Rate Results

每个 Rate 展示：

- Carrier。
- Provider。
- Service。
- Transit Days。
- Customer Price。
- Cheapest/Fastest 标记。

成本价不在客户页面展示。保存时同时保留 Provider Reference，例如 Priority1 Quote ID 或 WWEX Product Transaction ID/Offer ID。

### 6.8 Booking Details

共用信息：

- Ship Date。
- Pickup Ready Time。
- Pickup Close Time。
- Skip Address Verification。
- Reference/PO。

Sender 和 Receiver 分别包含：

- Company or Name。
- Country（当前固定 United States）。
- Address 1。
- Address 2（可选）。
- Postal Code。
- State/Prov。
- City。
- Phone。
- Extension（可选）。
- Contact Name。
- Email（可选）。
- Save to Address Book。

Address 3 已明确不需要。

### 6.9 Quotes

- 展示 `draft`、`booked` 和 `void` 等状态。
- 可按 Quote Number、Reference/PO、ZIP、客户或承运商搜索。
- Draft 可 Generate BOL。
- Booked 显示 BOL，可下载时显示 Download BOL，可 Void。
- 支持 Copy & Requote；复制路线、货物和联系人，但必须重新获取价格。

### 6.10 Orders

- 主要显示已生成 BOL 的运输记录。
- 支持按 BOL、PO、ZIP、客户或承运商搜索。
- 详情弹窗显示双方地址、货物行、服务、日期、价格和状态。
- 支持 Copy & Requote 和 Void Shipment。

### 6.11 Address Book

- 创建、修改、删除常用地址。
- Sender/Receiver 标题旁可直接打开 Address Book。
- Route 中也可以使用 Address Book 填充 ZIP/City/State。
- 指纹用于避免同一客户保存完全相同的地址。
- 地址只属于当前客户。

### 6.12 Deposit

每个客户一条 `deposit_accounts` 账户。

交易类型：

| 类型 | 金额方向 | 产生条件 |
|---|---:|---|
| `DEPOSIT` | 正数 | 管理员充值 |
| `ADJUSTMENT` | 正或负 | 管理员手工调整 |
| `BOL_RESERVE` | 负数 | Generate BOL 开始 |
| `BOOKING_RELEASE` | 正数 | 承运商提交失败并安全释放 |
| `VOID_REFUND` | 正数 | 承运商取消成功后退款 |

财务不变量：

- 可用余额不得小于 0。
- 余额不足不能进入 `booking`。
- 同一个 Quote 的关键操作使用 Idempotency Key 防止重复入账。
- 押金余额更新和交易流水必须在同一个数据库函数/事务中完成。
- Void 只能退一次。

当前 Deposit 不是支付系统，只是管理员维护的内部预存款账本。

### 6.13 Customers 和 Users

客户字段：

- Name。
- Code（唯一）。
- Active。
- Internal。
- Can Self Book。
- Markup Percent。
- Minimum Markup。

删除限制：

- QIANYUSHI 内部客户不可删除。
- 当前正在操作的客户不可删除。
- 有 Quote、Address、Deposit Transaction 或 Login User 的客户不可删除，应改为停用。

用户字段：

- Customer。
- Full Name。
- Email。
- Temporary Password。
- Role。
- Active。

用户可初始化密码。当前登录用户不能删除自己。

### 6.14 Settings

- Company Name。
- Contact Name。
- Email。
- Phone。
- Default Pickup Ready/Close Time。
- Default Markup Percent。
- Default Minimum Markup。
- WWEX Enabled。
- Priority1 Enabled。

至少必须启用一个报价渠道。

## 7. 承运商集成规格

### 7.1 统一模型

页面只处理统一的 `NormalizedRate`：

- provider
- carrier
- carrierCode
- service
- transitDays
- price
- providerRef

Provider 特有字段只能存在 `providerRef` 或服务端适配器中，不得散落在 UI。

### 7.2 Priority1

Rating：`POST /v2/ltl/quotes/rates`  
Dispatch：`POST /v2/ltl/shipments/dispatch`  
Status/Dedupe：`POST /v2/ltl/shipments/status`  
Cancel：`POST /v2/ltl/shipments/cancel`

认证：`X-API-KEY`，只在服务器端使用。

重复保护：

1. Generate BOL 前必须有非空 Reference。
2. 先用 `CUSTOMER_REFERENCE` 查询。
3. 404 表示没有既有运单，可以 Dispatch。
4. 恰好一条运单且同时有 Shipment ID、BOL 和 Pickup 时，恢复现有结果，不再 Dispatch。
5. 多条记录或资料不完整时停止操作并提示人工核对。

这是为处理“承运商已经创建运单，但 API 返回字段异常或连接中断”设计的安全机制。

已验证 ABF 沙盒：

- Shipment ID：`10564156`
- BOL：`60016048142`
- Pickup：`WWW0000000`
- Status：`Dispatched`
- 同一 Reference 查询结果：1 条

R&L 沙盒出现过 `Property 'EBolUrl' does not exist on JObject`，属于特定承运商/沙盒响应兼容问题，不能据此判断 Priority1 沙盒整体不支持 Pickup。

### 7.3 WWEX/SpeedShip

认证：OAuth 2.0 Client Credentials，Token 在服务端内存中缓存，并在到期前刷新。

主要 Flow：

- `shopFlow`：报价。
- `quoteOrderFlow`：创建运输并预约 Pickup。
- `documentDownloadFlow`：获取 BOL。
- `searchIndexDocumentFlow`：通过 BOL 查 Pickup Transaction。
- `integratedCancelFlow`：取消 Shipment/Pickup。

重复保护：Generate BOL 前先用 Product Transaction ID 查找已存在的 BOL；发现文档时恢复而不重复下单。

已验证 WWEX/ESTES 沙盒成功完成报价、BOL、Pickup、订单状态和押金扣款。

## 8. 报价与加价规则

客户价计算：

```text
百分比价格 = 成本价 × (1 + Markup Percent / 100)
最低加价价格 = 成本价 + Minimum Markup
客户价 = max(百分比价格, 最低加价价格)
客户价四舍五入到 2 位小数
```

示例：

- 成本价 `$400`
- 加价率 `12%` → `$448`
- 最低加价 `$35` → `$435`
- 最终客户价 `$448`

加价计算在服务端完成，前端只收到客户价。

## 9. Quote 状态机

| 当前状态 | 操作 | 下一状态 | 说明 |
|---|---|---|---|
| `draft` | Save | `draft` | 仅保存资料 |
| `draft` | Reserve deposit | `booking` | 原子扣押金 |
| `booking` | Carrier success + complete | `booked` | 保存 BOL/Pickup |
| `booking` | Safe failure + release | `draft` | 退回预扣款 |
| `booked` | Carrier cancel + refund | `void` | 退回原金额 |
| `void` | 无 | `void` | 终态 |

任何绕过状态机直接修改数据库状态的操作都可能破坏押金账本，禁止在生产数据库手工修改状态，除非同步完成审计和余额修复。

## 10. 数据模型

### 10.1 `customers`

客户主表，包含名称、代码、启用状态、自助出单权限和加价策略。

### 10.2 `app_users`

Supabase Auth 用户的业务 Profile。`user_id` 对应 `auth.users.id`，并绑定 `customer_id` 与角色。

### 10.3 `saved_quotes`

主要字段：

- 标识：`id`、`quote_number`、`reference`。
- 所属：`customer_id`。
- 状态：`status`、`booked_at`、`voided_at`。
- 路线：`origin_zip`、`destination_zip`、`ready_date`。
- Rate：`carrier`、`service`、`transit`、`price`、`provider`、`provider_ref`。
- Shipment：`freight_items`、`services`、`sender`、`receiver`。
- Pickup：`pickup_ready_time`、`pickup_close_time`。
- 承运商结果：`bol_number`、`bol_url`、`provider_shipment_id`、`provider_pickup_id`、`provider_document_ref`。

Shipment、Party 和 Provider Reference 使用 JSONB，便于适配多个承运商；需要复杂统计时应把关键字段提取为独立列或建立生成列/索引。

### 10.4 `address_book`

客户常用 Sender/Receiver 地址及联系人。`fingerprint + customer_id` 唯一。

### 10.5 `deposit_accounts`

每客户一条余额。`available_balance >= 0`。

### 10.6 `deposit_transactions`

不可缺少的押金审计流水，记录金额、交易后余额、Quote、Customer、操作人、原因、时间和 Idempotency Key。

### 10.7 `platform_settings`

单行平台配置表，主键固定为 `true`。

## 11. 服务端 API

| 路径 | 方法 | 用途 | 权限 |
|---|---|---|---|
| `/api/auth/session` | GET | 获取当前会话 | 公开入口/返回登录状态 |
| `/api/auth/login` | POST | 登录 | 未登录 |
| `/api/auth/logout` | POST | 退出 | 已登录 |
| `/api/auth/setup` | POST | 创建首位管理员 | 仅无用户时 |
| `/api/locations/[zip]` | GET | ZIP 对应州/城市 | 页面使用 |
| `/api/quotes/rates` | POST | 获取并加价后的报价 | 已登录 |
| `/api/quotes` | GET/POST | 查询或保存 Quote | 已登录/客户隔离 |
| `/api/quotes/[id]/bol` | POST | 扣款、BOL、Pickup | 已登录且可出单 |
| `/api/quotes/[id]/void` | POST | 承运商取消并退款 | 已登录 |
| `/api/quotes/[id]/document` | GET | WWEX BOL 文件代理 | 已登录/客户隔离 |
| `/api/addresses` | GET/POST | 地址簿列表/新增 | 已登录 |
| `/api/addresses/[id]` | PATCH/DELETE | 地址修改/删除 | 已登录 |
| `/api/deposit` | GET | 余额与流水 | 已登录 |
| `/api/deposit` | POST | 管理员调整押金 | Admin |
| `/api/customers` | GET/POST | 客户列表/新增 | Admin |
| `/api/customers/[id]` | PATCH/DELETE | 客户更新/删除 | Admin |
| `/api/customers/select` | POST | 切换当前客户 | Admin |
| `/api/users` | POST | 新建登录用户 | Admin / 本公司 Customer Admin |
| `/api/users/[id]` | PATCH/DELETE | 用户、密码或删除 | Admin / 本公司 Customer Admin |
| `/api/settings` | GET/POST | GET 按角色裁剪，POST 保存设置 | GET 已登录 / POST Admin |

## 12. 错误处理与恢复

### 12.1 Provider 部分失败

- 使用 `Promise.allSettled`，一个报价渠道失败不能阻止另一个渠道返回。
- 前端可获得 Provider Error，后续可增加更显眼的运维提示。

### 12.2 BOL 请求超时或响应异常

- 不允许假定失败等于“承运商未创建”。
- Priority1 使用完整 Quote UUID 生成 35 字符唯一标识；不得用用户 PO 查重，恢复时必须核对返回的 CUSTOMER_REFERENCE。
- WWEX 必须按 Product Transaction/Document 查询。
- 只有匹配系统标识且完整的记录才可恢复；异常保留 booking 和资金预留，不自动退款。管理员的“核对已有运单”仅查询，不创建、不再次扣款。
- 多条或不完整记录时停止并人工处理。

### 12.3 数据库最终写入失败

承运商成功后，如果 `complete_quote_bol` 失败，系统提示“不要再次点击”。这是高优先级人工处理状态，未来建议加入专门的 `needs_reconciliation` 状态和管理页面。

### 12.4 取消失败

- 保持订单 `booked`。
- 不退押金。
- 显示承运商错误。
- Priority1 沙盒 API Key 可能对部分取消操作返回 403。

## 13. 安全规格

- `.env.local` 永远不提交。
- `SUPABASE_SECRET_KEY`、`PRIORITY1_API_KEY`、`WWEX_CLIENT_SECRET` 仅存在服务器环境变量。
- 不允许在 React Client Component 中读取服务端密钥。
- Auth Cookie 为 HttpOnly、SameSite=Lax；生产环境启用 Secure。
- Admin API 必须调用 `requireAdminSession()`。
- 所有对象读取/修改必须校验当前客户所有权。
- 密码不写入数据库业务表，不写日志，不显示在列表。
- API 错误不应原样返回包含密钥、Token 或完整上游响应的内容。
- GitHub 仓库应设为 Private。
- 生产环境应定期轮换承运商 API 密钥和 Supabase secret key。
- GitHub 若曾误上传密钥，删除文件不够，必须立即吊销并重新生成密钥。

## 14. 非功能要求

### 14.1 正确性

- 金额使用数据库 Numeric，显示保留两位。
- 重量和尺寸必须大于 0。
- Reference 在 Priority1 Generate BOL 前必填。
- 同一 Quote 不得重复扣款、重复退款或重复生成 BOL。

### 14.2 性能

- 两个报价渠道并行请求。
- WWEX OAuth Token 缓存在服务器进程内。
- ZIP 查询使用本地静态数据。
- Quote/Deposit 查询限制返回数量，后续数据量增大时增加分页。

### 14.3 可用性

- 桌面优先并支持响应式布局。
- 关键按钮有 Loading/Disabled 状态。
- Generate BOL 有应用内确认弹窗，不使用可能阻塞自动化的浏览器原生 Confirm。
- 中英文可随时切换。

### 14.4 可维护性

- Provider API 逻辑集中在 `src/lib/carriers/`。
- 页面通过统一 Rate 和 Shipment Result 类型消费承运商数据。
- 数据库关键资金操作集中在 RPC 函数中。
- 任何新增 Provider 必须实现 Rating、Dispatch、Cancel 和 Dedupe/Recovery 策略。

## 15. 已知限制和技术债

1. 主页面 `page.tsx` 较大，后续应按 View 和业务组件拆分。
2. 当前 SQL 是迭代脚本集合，建议上线前合并为带版本号的正式 Migration。
3. Platform Settings 同时保留默认加价，但当前客户加价优先。
4. Priority1 的 Limited Access 已映射 LTDDEL（派送）；Overlength 尚未映射。
5. WWEX Overlength 尚未映射。
6. 危险品只能报价标记，不能出 BOL。
7. Priority1 恢复既有记录时可能没有可下载的 BOL URL。
8. Orders 尚无 Tracking/POD，这是产品范围决定，不是遗漏。
9. ZIP/City 数据用于路线补全；可选 Google 地址验证仅用于未明确类型的收货地址。
10. 当前 Quote/Order/Deposit 列表没有服务端分页。
11. tests/ 已包含识别、TQL 认证、客户隔离及安全状态机的模拟测试；真实承运商出单和取消验收需要单独授权。
12. 没有专门的审计日志表记录客户/用户/设置修改。
13. 新草稿在 provider_ref 中持久保存并签名 offerExpiresAt；过期禁止出单，旧草稿必须先核对历史承运商记录再重新询价。

## 16. 后续开发建议顺序

### P0：上线前必须

- 把 SQL 合并为正式 Migration 并在全新 Supabase 项目演练。
- 增加服务端环境变量启动检查。
- 为押金 RPC、BOL 状态机和客户隔离增加自动测试。
- 补齐 Priority1/WWEX 所有当前 UI Accessorial 映射，或从 UI 删除未支持项。
- 增加 `needs_reconciliation` 管理状态。
- 逐个生产承运商做可撤销小额测试。
- 增加结构化服务端日志，但严格屏蔽密钥和个人资料。

### P1：稳定性

- 拆分前端组件和 hooks。
- 列表分页、排序和日期过滤。
- Rate 有效期及过期重新询价。
- BOL 文档统一存储或安全代理。
- 运单人工备注和操作审计。

### P2：仅在业务确认需要后

- Tracking。
- POD。
- Invoice/Rebill。
- 邮件通知。
- 在线充值。

## 17. 完成定义

任何新功能只有同时满足以下条件才算完成：

- 业务行为符合本规格。
- 客户隔离和角色权限正确。
- 错误信息可理解。
- 不会泄露环境变量或上游敏感响应。
- `pnpm typecheck` 通过。
- `pnpm build` 通过。
- 相关数据库 SQL 已记录。
- 至少完成一条正常流程和一条失败/重试流程验收。
- 如果涉及资金或承运商操作，验证幂等性与恢复策略。

## 18. 变更管理

后续修改本规格时，应在 Git Commit 或 Pull Request 中明确：

- 修改原因。
- 影响的页面和 API。
- 是否需要数据库 Migration。
- 是否影响历史 Quote/Order。
- 是否影响押金余额。
- 是否改变承运商请求字段。
- 如何测试和回滚。

任何扩大产品范围的需求，例如 Tracking、POD、Invoice 或 Rebill，都应先单独更新产品范围和数据模型，不能直接混入现有 BOL 流程。


### 附加服务完整性修复（2026-11-27）

询价按平台先检查服务能否完整表达：TQL/WWEX不再把“住宅派送＋Limited access”静默降级为住宅；TQL拒绝两端住宅。只跳过不支持的平台，其余平台继续返回报价；电脑和手机页面均显示明确原因，全部无报价时也显示原因。旧的此类草稿在新出单预留押金前被阻止，已有待核对运单仍可核对。

Mothership新增delivery.limitedAccess。住宅未明确请求电话预约时发送residential＋scheduledDelivery，仅保留Mothership自营报价；明确勾选Appointment delivery时保留电话appointment，不混发scheduledDelivery，并排除需要数字预约的自营住宅报价，保留兼容的其他承运商报价。住宅提货不自动添加派送预约。Mothership仍仅比价，不支持本平台出单。

Overlength freight在四个平台均暂停自动报价并提示人工核实，不再将勾选项静默忽略。虽然Priority1公开ELS_6至ELS_30等代码，但尚未确认长度区间及承运商计费规则，不凭代码名称推断，也不手工加固定费用。确认规则后再实现。未勾选超长时仍按原逻辑传递真实尺寸，此修复不保证所有尺寸条件的超长费均已核实。

参考：Priority1 https://api.priority1.com/about；Mothership https://docs.mothership.com/reference/accessorials 及 https://docs.mothership.com/reference/createquote；TQL和WWEX使用其提供的接口说明与Postman样例。无需SQL。80项离线测试及完整构建通过；本次未向任何承运商发送真实询价或出单。
