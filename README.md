# QIANYUSHI LTL V2

Shenzhen Qianyushi Supply Chain Service Co., Ltd. 的轻量化美国 LTL 询价、报价保存、BOL、Pickup、客户账户与押金管理平台。

> 当前版本定位为可运行的 V2 MVP。范围刻意保持精简：不包含 Label、Tracking、POD、Invoice 或 Rebill。

## 已实现功能

- 中英文界面切换。
- 用户登录、退出、管理员初始化。
- 客户公司、登录用户、角色、启用状态与初始化密码管理。
- 客户独立报价、地址簿和押金数据隔离。
- 每个客户可配置加价百分比、最低加价和是否允许自行生成 BOL。
- Smart Quote：从多行中英文文本识别发货地、收货地、商业/住宅、尾门、预约、包装、尺寸和重量。
- 自动把厘米转换为英寸、千克转换为磅，并四舍五入。
- Freight Details 固定使用 inch / lb。
- 多货物行、包装类型、可堆叠、托数、尺寸、单托重量、自动总重量、自动密度 Class、危险品标记、英文品名与货值。
- 美国 ZIP Code 自动匹配州和城市；多城市 ZIP Code 可下拉选择。
- WWEX/SpeedShip、Priority1 与 TQL 实时询价适配。
- 每个渠道分别取最低五个报价，再统一排序。
- 客户销售价按 `max(成本价 × (1 + 加价率), 成本价 + 最低加价)` 计算。
- 保存 Quote 和完整 Sender/Receiver 下单资料。
- 在下单资料或 Quotes 页面生成 BOL。
- Generate BOL 同时向承运商预约 Pickup，并从客户押金扣款。
- Void Shipment 同时取消承运商运单/Pickup，并在成功后退回押金。
- WWEX BOL 文件下载。
- Priority1 按 Reference 查重和异常响应恢复，防止重复创建运单。
- TQL 报价、Tender、BOL 邮件发送与重复 Tender 恢复；密钥到位并获准测试后启用。
- Orders、Quotes、Address Book、Deposit、Customers、Settings 和 Help 页面。

## 报价界面更新（2026-11-14）

- 询价结果按现有排序显示前 5 条，统一使用单列列表。每条报价左侧用 P（Priority1）、T（TQL）或 W（WWEX）标明报价平台。
- 报价金额左侧显示预计运输天数（Transit days），手机端也可查看。承运商未返回时效时显示「未提供」。
- 首次打开询价页面时，READY DATE (PT) 默认填入美国太平洋时间的当天，自动适用冬令时和夏令时，可手动修改。询价及下单表单均标注时区。
- 双击报价行可打开该报价的下单表单。也可单击选择报价，再点「继续填写下单资料」。打开表单后仍需手动提交。

## 技术栈

资料识别页面更新（2026-11-19）：新增 `/shipment-reader`，支持粘贴文字/截图和上传图片、PDF、Excel、Word、TXT/CSV，先生成可编辑草稿及核对提醒，再手动带入询价。AI 文件识别需配置服务器 `OPENAI_API_KEY`，未配置时普通文字解析仍可使用；不会自动询价或创建运单。参见 [使用与配置说明](docs/SHIPMENT-READER.md)。

- Next.js 16 App Router
- React 19
- TypeScript
- Supabase Postgres、Auth 与 REST/RPC
- Priority1 LTL API
- WWEX/SpeedShip API
- TQL LTL API
- pnpm

## 项目结构

```text
.
├─ public/                     Logo 等公开静态文件
├─ src/
│  ├─ app/
│  │  ├─ api/                  登录、客户、地址、报价、BOL、押金等服务端接口
│  │  ├─ globals.css           全局页面样式
│  │  ├─ layout.tsx            页面元数据和根布局
│  │  └─ page.tsx              当前单页工作台界面
│  ├─ data/                    ZIP Code 与城市数据
│  └─ lib/
│     ├─ carriers/             Priority1、WWEX 和 TQL 适配器
│     ├─ auth-server.ts        登录会话和角色权限
│     ├─ smart-quote-parser.ts Smart Quote 解析器
│     └─ supabase-server.ts    Supabase 服务端访问封装
├─ outputs/                    Supabase SQL 与历史产品需求基线
├─ docs/                       详细规格、部署和 GitHub 指南
├─ .env.example                环境变量模板，不含真实密钥
└─ package.json
```

`API/` 是本机参考资料目录，可能包含接口凭据，已加入 `.gitignore`，不会包含在 GitHub 安全包中。

## 本地运行

要求：Node.js 20 或更高版本，推荐使用 pnpm。

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev
```

在 `.env.local` 中填入 Supabase 和需要启用的承运商配置，然后打开：

```text
http://localhost:3000
```

## 检查与正式运行

```powershell
pnpm typecheck
pnpm build
pnpm start
```

## 数据库安装

在新的 Supabase 项目中，按以下顺序在 SQL Editor 执行：

1. `outputs/supabase-create-saved-quotes.sql`
2. `outputs/supabase-enable-address-book.sql`
3. `outputs/supabase-enable-bol-and-deposit.sql`
4. `outputs/supabase-fix-bol-retry.sql`
5. `outputs/supabase-enable-login-and-customers.sql`
6. `outputs/supabase-enable-settings.sql`
7. `outputs/supabase-complete-sidebar-features.sql`
8. `outputs/supabase-correct-qianyushi-name.sql`
9. `outputs/supabase-enable-tql.sql`
10. `outputs/supabase-enable-address-categories.sql`
11. `outputs/supabase-enable-dual-address-category.sql`
12. `outputs/supabase-enable-single-session.sql`
13. `outputs/supabase-enable-customer-admin.sql`
14. `outputs/supabase-enable-login-email-change.sql`
15. `outputs/supabase-enable-quote-input-history.sql`
16. `outputs/supabase-add-quote-input-username.sql`
17. `outputs/supabase-enable-mothership-settings.sql`
18. `outputs/supabase-fix-booking-attempt-ledger.sql`
19. `outputs/supabase-security-hardening.sql`
20. `outputs/supabase-enable-ai-budget.sql`
21. `outputs/supabase-enable-booking-release-audit.sql`

这些脚本使用 `IF NOT EXISTS` 或兼容性修改为主，但生产环境执行前仍应备份数据库。完整说明见 [Supabase 部署说明](docs/SUPABASE-SETUP.md)。

## 首次管理员

数据库 SQL 完成且 `app_users` 为空时，首页会显示首次管理员创建界面。创建后即可登录。总管理员可以管理客户、用户、押金、平台设置，并切换当前操作客户。

## 环境变量

| 变量 | 作用 | 是否可公开 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL | 可以 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Auth publishable key | 可以 |
| `SUPABASE_SECRET_KEY` | 服务端数据库管理密钥 | 绝对不可以 |
| `PRIORITY1_API_BASE` | Priority1 沙盒 API 根地址 | 建议保密 |
| `PRIORITY1_API_KEY` | Priority1 API 密钥 | 绝对不可以 |
| `WWEX_AUTH_URL` | WWEX OAuth 地址 | 建议保密 |
| `WWEX_CLIENT_ID` | WWEX OAuth Client ID | 不可以 |
| `WWEX_CLIENT_SECRET` | WWEX OAuth Client Secret | 绝对不可以 |
| `WWEX_AUDIENCE` | WWEX OAuth audience | 建议保密 |
| `WWEX_API_BASE` | WWEX 沙盒 API 根地址 | 建议保密 |
| `TQL_AUTH_URL` | TQL OAuth 地址 | 建议保密 |
| `TQL_API_BASE` | TQL LTL API 根地址 | 建议保密 |
| `TQL_SUBSCRIPTION_KEY` | TQL API subscription key | 绝对不可以 |
| `TQL_CLIENT_ID` | TQL OAuth Client ID | 不可以 |
| `TQL_CLIENT_SECRET` | TQL OAuth Client Secret | 绝对不可以 |
| `TQL_USERNAME` | TQL TRAX 用户名 | 不可以 |
| `TQL_PASSWORD` | TQL TRAX 密码 | 绝对不可以 |
| `TQL_SCOPE` | TQL OAuth scopes（空格分隔） | 建议保密 |
| `TQL_BOL_EMAIL` | 接收 TQL BOL 的邮箱 | 不建议公开 |

## 安全原则

- 浏览器不直接获得 Supabase secret key 或承运商密钥。
- 所有数据库和承运商调用均由 Next.js Route Handlers 在服务器端完成。
- 登录令牌保存在 HttpOnly Cookie 中。
- 数据表启用 RLS，并撤销 anon/authenticated 的直接访问；应用服务器使用 secret key 访问。
- `.env.local`、`API/`、构建缓存和依赖目录禁止上传 GitHub。
- GitHub 仓库建议设为 Private。

## 当前验证结果

- TypeScript 检查通过。
- Next.js 正式构建通过。
- WWEX/ESTES 沙盒已成功返回 BOL 并安排 Pickup。
- Priority1/ABF 沙盒已成功返回 BOL `60016048142` 与 Pickup `WWW0000000`。
- Priority1 Reference 查重确认同一 Reference 只有一票运单。
- TQL 生产认证和报价已验证；真实 Tender、取消及资金核对仍需单独批准的验收，不等同于已完成真实出单测试。
- R&L 沙盒曾出现承运商在服务器端创建运单、但响应字段异常的情况；当前版本已在重试前查询 Reference，并可在只有一条且 BOL/Pickup 齐全时恢复该结果。

## 详细文档

- [产品与开发规格](docs/PRODUCT-AND-DEVELOPMENT-SPEC.md)
- [Supabase 部署说明](docs/SUPABASE-SETUP.md)
- [GitHub 上传与部署指南](docs/GITHUB-UPLOAD-GUIDE.md)
- [测试与验收清单](docs/TEST-AND-ACCEPTANCE.md)

## 明确不在当前版本范围内

- Shipping Label
- Tracking
- POD
- Invoice
- Rebill/Adjustment 工作流
- 生产承运商账号切换
- 危险品 BOL 的完整 UN Number、Proper Shipping Name、Packing Group 等申报

生产上线前必须换成生产 API 地址与密钥，并使用小额、可撤销测试单逐家承运商验收。

TQL 当前没有提供取消 API。TQL 运单必须先联系 TQL 人工取消，系统不会在承运商取消前自动退款。

安全状态机、待核对运单操作及数据库验证见 [安全修复说明](docs/SECURITY-HARDENING.md)。

资料识别使用 GPT-6 Luna；每日保护额度、超额暂停及提示见 [资料识别说明](docs/SHIPMENT-READER.md)。

## 2026-11-20 界面优化

- 报价页采用紧凑工作台布局：缩小标题和表单间距，货物字段在中等屏幕分两行排列，保留尺寸完整显示；报价结果采用紧凑间隔色列表。
- 资料识别页压缩上传区和空白预览，增加用量条，将额度说明折叠；额度不足提示继续直接显示，保留文件打开及货物编辑。
- 公司账户统一绿色导航和用户列表；客户工作区改为更小的多列卡片。
- 设置页移除 TQL 连接检查入口。此次仅调整界面，不改报价计算、客户权限、数据库结构或承运商调用流程。

## 客户押金总览（2026-11-20）

总管理员进入 Deposit 可按行查看所有客户的最近一次实际充值金额、充值时间（PT）及当前可用余额。最近充值仅统计正数 DEPOSIT，排除取消退款、预留释放及余额修正。无充值与未开户分别标识，不以零余额代替缺失账户。

点击客户行打开其充值、出单扣款/预留、预留释放及取消退款流水，显示变动金额、变动后余额、报价单及说明，支持搜索客户和每页50条翻页。查看明细不会切换工作区。总管理员可在客户明细窗口展开“充值／调整押金”，明确显示目标客户；正数充值、负数扣减，必填付款凭证或原因，提交后刷新总览与明细。页面下方不再重复显示工作区充值调整区域。总览及跨客户明细接口仅限总管理员；客户管理员和普通用户仍只看自己公司的押金。无需数据库迁移。

## 客户加价统一设置（2026-11-20）

Settings 已移除 Customer pricing；接口不再返回或保存平台默认加价。加价百分比和最低加价统一由总管理员在 Company Account → 客户工作区 → 编辑中设置。询价只读取当前客户的有效加价，0% 是明确的零加价；客户资料缺失、停用、加价无效或读取失败时暂停询价，在调用任何承运商前返回明确提示，不回退为平台加价或零加价。历史数据库字段保留但不再使用，无需数据库迁移。验证包含普通及流式询价、设置接口及零加价情况，使用模拟承运商，不发送真实询价。

## 导航名称调整（2026-11-20）

Company Account 位于侧边栏 Settings（设置）分组下；原 Settings 入口、页面标题及面包屑改名为 Profile（资料设置），保存按钮改为 Save profile。原有管理员权限、资料和报价渠道设置功能保持不变。
