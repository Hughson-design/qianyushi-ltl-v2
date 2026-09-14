# Justnano LTL 打单平台 V2：产品需求基线

> **已由精简版 v0.4 取代。** 当前首版不包含 Pickup、Tracking、POD、Invoice、Rebill 和 Label；请以 `LTL-V2-精简产品需求基线-v0.4.md` 为准。

- 文档版本：v0.1
- 基线日期：2026-09-11
- 状态：可进入页面原型、数据模型与接口设计
- 参考范围：Kapai《客户使用手册》、当前对话已确认的 Priority1/Cabo 业务经验、Justnano 既有 LTL 操作需求

> 本文是产品范围与开发优先级的共同基线，不是最终 API 字段说明。Priority1/Cabo 原始手册和接口文档尚未附在当前任务中，因此本文只把已经确认的通用 LTL 操作逻辑写为基线；具体字段、限制和接口能力需要在接入每个渠道时再次验证。

## 1. 产品定位

为 Justnano 建立一套面向美国 LTL 业务的多租户 TMS/客户门户，让客户与内部人员在同一系统完成：

**客户/地址 → 询价 → 多渠道比价 → 选择费率 → 下单 → Pickup → BOL/Label → Tracking → POD → Invoice/Rebill**

V2 不是复制 Kapai 或 Priority1，而是组合三类优势：

1. Kapai：客户自助、报价/订单历史、地址库、余额/押金、追加费用与申诉。
2. Priority1/Cabo：标准美国 LTL 字段、费率比较、承运商下单、PRO、提货与单证生命周期。
3. Justnano：多渠道成本比较、客户差异化售价、利润控制、异常费用管理和后续 AI 自动化。

### 1.1 成功标准

- 常规历史客户可在 3 分钟内完成一次询价并下单。
- 非价格字段变化不重复调用 Rate API。
- 每票货的报价、成本、售价、承运商响应、文件、轨迹与费用调整均可追溯。
- 客户永远看不到渠道成本、毛利和其他客户数据。
- 任一渠道失败不阻断其他渠道返回报价。
- 运营人员可以在一个订单详情页处理绝大多数日常工作。

### 1.2 MVP 不包含

- 自动付款、信用卡支付和完整会计总账。
- AI 自动下单或无人审批的自动 Dispatch。
- 面向外部市场的承运商开放平台。
- FTL、Parcel、Ocean、Air 等非 LTL 产品。
- 对所有承运商一次性全量接入。

## 2. 关键产品决策

### D-01 报价与订单分离

Quote 是可过期、可比较的报价容器；Shipment/Order 是客户接受某条 Rate 后形成的履约对象。过期 Rate 不得下单。

### D-02 只在价格因素变化时重新询价

以下字段变化使已选 Rate 失效：起运/目的 ZIP、商业/住宅类型、货物件数、包装、尺寸、重量、Freight Class、NMFC、Hazmat、Stackable、Declared Value，以及任何计费 Accessorial。

联系人、电话、邮箱、PO/Reference、Dock Hours、备注等非计费字段变化，不触发重新询价。

### D-03 成本与售价彻底分离

每条 Rate 同时保存渠道原始成本、标准化成本、Markup 规则、客户售价和预计毛利。客户侧只返回售价及允许公开的费用明细。

### D-04 统一 Carrier/Channel Adapter

前端和核心订单逻辑只调用统一领域接口；WWEX、Priority1、TForce、Roadrunner、FedEx Freight、XPO、ABF、Old Dominion、Ward、Frontline、AAA Cooper、Pilot 等均通过适配器接入。

统一能力至少包括：Rate、Book/BOL、Pickup、Cancel、Track、Documents；不支持的能力必须明确返回 `unsupported`，不能假装成功。

### D-05 原始响应与审计不可丢失

所有外部请求/响应、状态变更、价格变更、人工操作和文件版本均保留审计记录。外部创建类操作必须有幂等键，避免重复下单或重复预约。

### D-06 订单详情是运营中心

Tracking、Pickup、PRO、BOL、Label、POD、Invoice、Adjustment、内部备注和客户沟通都聚合在订单详情，减少页面跳转。

## 3. 平台功能对照与 V2 决策

优先级定义：P0 = 首发必须；P1 = 首发后第一阶段；P2 = 增强/自动化。

| 功能 | Kapai 参考 | Priority1/Cabo 参考 | V2 基线决定 | 优先级 |
|---|---|---|---|---|
| 客户独立账号 | 有客户角色与隔离 | 有账户化操作逻辑 | 多租户隔离；客户只能访问本公司数据 | P0 |
| Dashboard | 余额、消息、报价、订单摘要 | 运营概览 | 合并近期报价、在途订单、异常、待处理事项 | P1 |
| 快速询价 | 先核心字段，再补信息 | 标准 LTL Rate 流程 | 单页分步表单；先填计费字段即可比价 | P0 |
| 多承运商比价 | 展示可用价格 | 成熟的渠道/承运商报价 | 统一列表展示售价、时效、服务、到期时间 | P0 |
| Quote 与 Order 分离 | 明确分离且报价可过期 | 标准 Quote/Book 生命周期 | 保留，Rate 过期或价格字段变化必须重询 | P0 |
| 补资料后重新询价 | 大多要求重新询价 | 依渠道规则 | 仅价格字段改变才重询；其他字段直接补全 | P0 |
| 锁价/选价 | 选择最新报价下单 | Rate selection | 选中 Rate 后短期保留；最终提交前验证有效性 | P0 |
| Address Book | 有用途、联系人、电话、营业时间 | 常用地点复用 | 支持地址校验、默认 Accessorial、Dock Hours、联系人 | P0 |
| Quote History | 可查询并继续操作 | 报价历史 | 可搜索、复制、重询、从有效 Rate 下单 | P0 |
| Order History | 订单号、Reference、PRO、日期、状态 | 标准 shipment history | 统一搜索、筛选、导出；保存常用视图 | P0 |
| 再次下单 | 复制旧订单并重新询价 | 常见复制流程 | 复制路线/货物/服务，但永远获取新 Rate | P0 |
| Pickup | 流程中包含提货信息 | 标准 Pickup 操作 | 创建、变更/取消（依渠道能力）、保存确认号 | P0 |
| BOL / Label | 集中下载 | 标准单证 | 下单成功自动生成/抓取，可重新下载与版本化 | P0 |
| Tracking | 订单内查看 | PRO/状态追踪 | API/Webhook 优先，定时轮询兜底，标准化轨迹 | P0 |
| POD | 订单内下载 | 交付文件 | 自动抓取；客户和运营可下载 | P1 |
| 取消订单 | 提交原因并等待处理 | 依订单阶段/渠道规则 | 根据状态判断自动取消或转人工；记录可能费用 | P1 |
| 余额/押金 | 美元余额、押金、冻结与流水 | 信用/账单逻辑 | 首发先做信用额度与交易台账；预充值放 P1 | P1 |
| Invoice | 订单文件集中 | 标准账单逻辑 | 生成客户账单，关联原价、调整与付款状态 | P1 |
| Rebill/Adjustment | 追加费用、冻结、申诉 | 承运商账单调整 | 独立对象和证据链；支持接受、申诉、关闭 | P1 |
| Markup/利润 | 客户不见平台成本 | 渠道成本基础 | 按客户/渠道/承运商/服务配置，支持最低毛利 | P0 |
| 消息/通知 | 站内消息 | 业务通知 | 首发邮件+站内事件；短信/企业微信后续扩展 | P1 |
| 报表 | 基础流水 | 运营与账单数据 | 订单量、收入、成本、毛利、Adjustment、渠道表现 | P1 |
| AI 识别邮件/BOL | 无 | 非核心 | 人工确认后填入 Quote 草稿 | P2 |
| 智能推荐 Carrier | 无 | 可利用历史表现 | 解释价格/时效/稳定性，不自动替客户决定 | P2 |
| 自动异常提醒 | 基础校验 | 规则经验 | 先规则引擎，后引入 AI | P1/P2 |

## 4. 用户、权限与数据边界

### 4.1 角色

| 角色 | 核心权限 |
|---|---|
| Super Admin | 系统配置、所有租户、渠道凭证、权限与审计 |
| Operations | 报价、订单、Pickup、文件、Tracking、异常与人工修正 |
| Sales/Account Manager | 自己负责的客户、报价、售价策略查看、客户协助下单 |
| Finance | 成本、售价、利润、Invoice、Credit、Rebill、导出 |
| Customer Admin | 本公司用户、地址库、报价、订单、文件、账单 |
| Customer User | 按授权创建报价/订单并查看本公司数据 |
| Read-only/Auditor | 指定范围只读 |

### 4.2 强制数据隔离

- 所有客户数据表必须带 `tenant_id/customer_account_id`。
- 成本、毛利、渠道凭证和内部备注不得进入客户 API 响应。
- 客户用户权限应支持：可报价、可下单、可看账单、可管理地址、只读。
- 敏感操作需要审计：改价、手工选择成本、取消、重新下单、Rebill、退款、下载敏感文件。

## 5. 端到端业务流程

### 5.1 标准询价与下单

1. 用户选择地址库或输入起运/目的地址。
2. 系统完成 ZIP/州/城市校验并提示地址类型风险。
3. 用户填写 ready date、货物行、Class/NMFC、Accessorial。
4. 系统并行请求已启用渠道；单个渠道失败不影响其他结果。
5. 适配器标准化每条 Rate；定价引擎计算客户售价。
6. 用户按价格、时效、承运商筛选并选择 Rate。
7. 用户补全联系人、营业时间、PO/Reference、备注和预约信息。
8. 系统比较价格指纹；若未改变且 Rate 有效，允许直接下单。
9. 系统创建 Shipment，向渠道 Book，并创建/关联 Pickup。
10. 返回内部订单号、渠道确认号、PRO（如已有）、BOL 和 Label。
11. Tracking 服务持续更新；交付后抓取 POD。
12. 财务形成 Invoice；后续费用进入 Adjustment 流程。

### 5.2 部分渠道失败

- 报价页面持续显示成功返回的结果和清晰的渠道状态。
- 超时、认证失败、无服务、数据不合格必须区分。
- 运营人员可重试单个渠道，不得重新请求所有成功渠道。
- 原始错误仅内部可见，客户看到可行动的简化提示。

### 5.3 复制旧订单

- 可复制地址、联系人、货物、服务和参考号模板。
- 不复制旧 Rate、旧 Pickup、旧 PRO、旧 BOL 或旧费用。
- 新对象从 Quote Draft 开始，必须重新询价。

### 5.4 Adjustment/Rebill

1. 承运商账单或人工导入产生费用差异。
2. 系统建立 Adjustment，关联原因、金额、证据和原始订单。
3. 财务审核成本并决定客户应收金额。
4. 客户看到允许公开的原因、金额、文件和截止时间。
5. 客户接受或申诉；申诉期间状态与信用占用按财务规则处理。
6. 最终批准、驳回或部分调整，并形成不可篡改流水。

常见原因：Reweigh、Reclass、Limited Access、Liftgate、Appointment、Redelivery、Address Correction、Dry Run、Detention、Inside Delivery、Overlength。

## 6. 模块架构

### 6.1 客户与权限

- 组织、客户账号、用户、角色、权限、销售归属。
- 信用状态、下单开关、默认币种、默认 Markup 方案。
- 登录、密码重置、会话管理；MFA 放 P1。

### 6.2 地址与联系人

- 结构化地址、用途（Shipper/Consignee/Both）、联系人、电话、邮箱。
- Dock Hours、时区、预约说明、默认 Accessorial、地点标签。
- 地址校验结果和人工确认标记。

### 6.3 Quote / Rate

- Quote Draft、货物行、Accessorial、服务请求。
- 多渠道请求编排、超时与重试、原始响应保存。
- Rate 标准化、过期时间、Transit Days、服务说明和限制。
- 价格指纹、重新询价判断、Quote 复制与历史。

### 6.4 Pricing

- 成本费用项标准化：linehaul、fuel、accessorial、discount、minimum、other。
- Markup 作用域：全局 → 客户组 → 客户 → 渠道/承运商 → Lane/服务。
- 支持百分比、固定额、每票最低毛利和人工覆盖。
- 人工改价必须填写原因并审计。

### 6.5 Shipment / Order

- 内部订单号、客户 Reference/PO、选中 Rate 快照。
- Shipper/Consignee 快照，避免地址库后续修改影响旧订单。
- 货物、特殊说明、预约、渠道确认号、PRO。
- 取消、复制、异常、内部备注和客户可见备注。

### 6.6 Pickup / Dispatch

- Ready Date、窗口、Dock Close、联系人、确认号。
- Pickup 与 Shipment 分离建模，允许依渠道规则合并多票。
- 创建、确认、变更、取消、失败转人工。

### 6.7 Documents

- BOL、Shipping Label、Pickup Confirmation、POD、Carrier Invoice、Customer Invoice、Adjustment Evidence。
- 文件类型、来源、版本、可见范围、生成时间、校验值和下载审计。

### 6.8 Tracking / Exception

- 标准事件模型：时间、地点、状态、描述、来源。
- 预计提货/送达、实际提货/送达、最后同步时间。
- 异常规则：未提货、无更新、延误、拒收、损坏、需预约、POD 缺失。

### 6.9 Billing / Credit / Adjustment

- Customer Invoice、费用行、税费（如适用）、余额、付款状态。
- Credit limit、可用额度、占用额度和流水。
- Adjustment/Rebill、申诉、证据、审批和结案。

### 6.10 Integrations / Adapter

- 渠道连接、凭证、环境、能力矩阵、健康状态。
- Rate/Book/Pickup/Cancel/Track/Documents 统一契约。
- Webhook 接收、轮询调度、重试队列、Dead Letter Queue。

### 6.11 Notifications / Reports

- 事件模板、收件人规则、发送记录和退信状态。
- 标准报表与 CSV/XLSX 导出；客户报表不得含成本。

## 7. 核心状态模型

### 7.1 Quote

`DRAFT → RATING → QUOTED → RATE_SELECTED → BOOKED`

旁路状态：`PARTIAL_RESULTS`、`NO_RATES`、`EXPIRED`、`INVALIDATED`、`CANCELLED`。

### 7.2 Shipment

`DRAFT → BOOKING → BOOKED → PICKUP_PENDING → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED → CLOSED`

旁路状态：`BOOKING_FAILED`、`EXCEPTION`、`CANCEL_PENDING`、`CANCELLED`。

外部承运商状态必须映射到内部标准状态，同时保留原始状态。

### 7.3 Pickup

`NOT_REQUESTED → REQUESTING → CONFIRMED → COMPLETED`

旁路状态：`FAILED`、`CHANGE_PENDING`、`CANCEL_PENDING`、`CANCELLED`。

### 7.4 Adjustment

`DRAFT → INTERNAL_REVIEW → CUSTOMER_PENDING → ACCEPTED/DISPUTED → RESOLVED → POSTED`

### 7.5 Invoice

`DRAFT → ISSUED → PARTIALLY_PAID → PAID`

旁路状态：`VOID`、`OVERDUE`、`CREDITED`。

## 8. P0：首发 MVP 范围

### Epic A：基础平台与权限

- FR-A01：创建客户、用户和角色。
- FR-A02：客户数据隔离和内部/客户字段隔离。
- FR-A03：登录、退出、重置密码、账号启停。
- FR-A04：完整审计日志。

### Epic B：地址与货物

- FR-B01：地址库增删改查、搜索和去重提示。
- FR-B02：联系人、Dock Hours、预约说明和默认服务。
- FR-B03：多货物行、单位转换、包装、尺寸、重量、Class/NMFC。
- FR-B04：Residential、Liftgate、Appointment、Limited Access 等 Accessorial。

### Epic C：报价与定价

- FR-C01：创建 Quote Draft 并验证必填计费字段。
- FR-C02：并行请求至少两个真实渠道或一个真实渠道加一个测试适配器。
- FR-C03：标准化并展示费率、时效、服务和到期时间。
- FR-C04：客户级 Markup 与最低毛利。
- FR-C05：价格指纹与精确重新询价。
- FR-C06：报价搜索、过期、复制和重新询价。

### Epic D：下单、Pickup 与单证

- FR-D01：有效 Rate 创建 Shipment，保存完整价格快照。
- FR-D02：幂等 Book，失败可安全重试。
- FR-D03：创建 Pickup 并保存确认号。
- FR-D04：获取或生成 BOL、Label。
- FR-D05：订单搜索支持订单号、Reference/PO、PRO、日期、状态。
- FR-D06：复制旧订单到新的 Quote Draft。

### Epic E：Tracking

- FR-E01：按 PRO/渠道引用同步 Tracking。
- FR-E02：标准化状态和事件时间线。
- FR-E03：订单详情展示最后更新时间和原始承运商状态。
- FR-E04：同步失败告警与人工重试。

### MVP 出口验收

- 两个客户账号之间不存在任何数据串读。
- 客户 API/页面中搜索不到成本、毛利、凭证或内部备注。
- 修改电话不会使 Rate 失效；修改重量会使 Rate 失效。
- 渠道超时后仍能展示其他成功报价。
- 重复点击下单不会生成两票外部 Shipment。
- 下单后能取得订单号、渠道确认号及 BOL；PRO 可在承运商生成后回填。
- 可按订单号、Reference、PRO、日期和状态找到订单。
- 复制订单必须得到新 Quote 和新 Rate。
- 每次外部调用、改价和状态变更均可审计。

## 9. P1：运营与财务闭环

- POD 自动获取与客户下载。
- 取消流程、取消费提示和人工审批。
- Dashboard 与异常工作台。
- Invoice、信用额度、余额/流水和账期。
- Adjustment/Rebill 与客户申诉。
- 邮件/站内通知。
- 利润、渠道成功率、Transit 表现、费用调整报表。
- MFA、细粒度权限和批量导出。
- 规则型异常提醒与 Accessorial 风险提示。

P1 完成后，平台才算具备完整的商业运营闭环；P0 只是稳定完成询价、下单和追踪。

## 10. P2：智能化与规模化

- 上传 BOL/PDF/Excel/邮件自动生成 Quote Draft，必须人工确认。
- 自动建议 Freight Class/NMFC，并显示依据和置信度。
- 基于价格、时效、历史准点率和异常率推荐 Carrier。
- 自动回复 Tracking/POD 类客户请求。
- Carrier Invoice 自动对账和 Adjustment 候选识别。
- 多语言门户、白标、客户 API 与 Webhook。
- 动态定价、Lane 规则和大客户合约价。

## 11. 推荐开发拆分

以下按两周一个迭代估算；实际工期取决于团队规模、接口文档质量和渠道测试账号。

| 迭代 | 交付物 | 可演示结果 |
|---|---|---|
| Sprint 0 | PRD 定稿、线框图、数据模型、API 契约、渠道能力矩阵 | 关键业务与字段无歧义 |
| Sprint 1 | 登录、租户/用户/角色、客户与地址库 | 两个客户可安全隔离操作 |
| Sprint 2 | Quote Draft、货物、Accessorial、校验、价格指纹 | 可完成标准询价表单 |
| Sprint 3 | 适配器框架、测试适配器、第一个真实 Rate 接口 | 可返回并保存第一批真实报价 |
| Sprint 4 | 第二个渠道、并行编排、标准化、Markup、报价列表 | 可多渠道比价并显示客户售价 |
| Sprint 5 | Rate 选择、Shipment、幂等 Book、订单搜索 | 可从报价生成真实订单 |
| Sprint 6 | Pickup、BOL、Label、文件中心 | 可完成提货预约与打印 |
| Sprint 7 | Tracking、状态映射、订单时间线、失败重试 | 可追踪已下单货物 |
| Sprint 8 | 安全、审计、端到端测试、试点迁移、上线准备 | P0 试点发布 |
| Sprint 9-11 | POD、取消、Dashboard、通知、异常 | 运营闭环增强 |
| Sprint 12-14 | Invoice、Credit、Rebill、申诉、报表 | 财务闭环完成 |
| 后续 | AI、自动对账、智能推荐、更多渠道 | P2 增强 |

### 渠道接入顺序建议

1. 第一渠道：选择文档完整、Sandbox 稳定、当前业务量高的渠道，用于打通全生命周期。
2. 第二渠道：选择报价量高且与第一渠道字段差异明显的渠道，验证统一 Adapter 是否合理。
3. 后续渠道：按业务量 × 毛利贡献 × 接口成熟度排序，不按名单顺序机械接入。

当前候选池：Priority1、WWEX、TForce、Roadrunner、FedEx Freight、XPO、ABF、Old Dominion、Ward、Frontline、AAA Cooper、Pilot。

## 12. Sprint 0 必须产出的设计件

1. 页面地图与低保真原型：登录、Dashboard、Quote、Rate List、Order Detail、Orders、Address Book、Customers、Pricing、Adjustments、Reports、Settings。
2. 领域数据模型：Organization、User、Address、Contact、Quote、QuoteLine、Rate、PriceComponent、Shipment、Pickup、TrackingEvent、Document、Invoice、Adjustment、AuditLog。
3. 统一 Adapter 契约与错误码。
4. 价格指纹字段清单和 Rate 失效规则。
5. Markup 优先级与舍入规则。
6. 角色权限矩阵。
7. 渠道能力矩阵与第一个接入渠道选择。
8. P0 端到端测试用例与试点客户名单。

## 13. 尚待确认的产品问题

这些问题不阻塞当前基线，但必须在对应开发开始前定案：

1. 首发用户仅 Justnano 内部，还是同时开放客户 Portal？
2. 第一、第二个真实渠道分别选择哪两个？是否已有 Sandbox、API Key 和完整文档？
3. Pickup 是默认随 Book 自动创建，还是允许只下单、不约提货？
4. 客户计费采用预充值、信用额度、账期，还是三者并存？
5. Markup 以总成本加价为主，还是需要按费用项分别加价？
6. 是否允许运营人员隐藏某些 Carrier，或只展示白标服务名？
7. BOL 以平台统一模板为主，还是优先使用渠道返回版本？
8. 首发通知渠道是 Email、企业微信，还是两者？
9. 是否需要人民币押金与美元余额双币体系？若需要，汇率和结算责任如何定义？
10. Priority1/Cabo 原始手册、Welcome Packet、字段/API 文档和历史样例应补充到项目资料库，供字段级核验。

## 14. 资料可信度与变更规则

### 已确认

- Kapai 客户侧包含登录、工作台、询价、补全信息/重新询价、报价历史、订单、Tracking、BOL/POD、取消、余额/押金、追加费用和地址库。
- Kapai 将 Quote 与 Order 分开；报价可过期；复制订单时需要重新询价。
- 客户不应看到平台成本、毛利或上游渠道调用信息。
- Justnano 目标渠道池和多渠道统一接入方向已经在对话中确认。

### 尚未以原始资料核验

- Priority1/Cabo 每个页面、字段、状态和 API 的精确行为。
- 每家渠道对 Pickup、取消、Label、POD、Webhook 和幂等的实际支持程度。
- 现有历史订单数据的完整字段分布和异常类型频率。

### 基线变更规则

- 新需求必须关联到模块、优先级和验收标准。
- 改动 P0 范围时，必须说明对数据模型、适配器、工期和上线风险的影响。
- 渠道专属字段不得直接污染核心模型；优先放入适配器映射或明确的扩展字段。
- 未经确认的推测不得写成必做业务规则。

## 15. 下一步推荐

以本基线为输入立即进入 Sprint 0，顺序为：

1. 锁定 10 个待确认问题中的前 7 个。
2. 画出客户询价、运营订单详情和财务 Adjustment 三条主流程原型。
3. 建立领域 ERD 和统一 Adapter 接口。
4. 选择首个真实渠道并用其文档校验模型。
5. 把 P0 Epic 拆成可估算的用户故事和测试用例。
