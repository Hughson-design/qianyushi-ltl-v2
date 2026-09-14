# Supabase 数据库与登录部署说明

## 1. 适用场景

本文用于：

- 在全新 Supabase 项目建立 QIANYUSHI LTL V2 数据库。
- 把本地项目连接到已建立的 Supabase 项目。
- 配置首次管理员登录。
- 检查押金、客户隔离与 BOL RPC 是否完整。

当前正在使用的 Supabase 项目已经执行过迭代 SQL。除非重建数据库，不要为了“再确认一次”而随意重复执行全部脚本。

## 2. 安全准备

执行数据库脚本前：

1. 确认当前选择的是正确 Supabase Project。
2. 如果不是空项目，先在 Supabase Dashboard 创建备份。
3. 不要把数据库密码、Secret Key 或 Carrier Key 粘贴进 SQL 文件。
4. SQL Editor 弹出“Potential issue detected”是因为脚本包含 `ALTER`、`DROP CONSTRAINT` 或 `DROP FUNCTION`。只有目标项目正确且已备份时才确认。

## 3. 全新数据库执行顺序

在 Supabase Dashboard → SQL Editor 中，每次打开一个文件、完整粘贴、点击 Run，确认成功后再执行下一份：

1. `outputs/supabase-create-saved-quotes.sql`
2. `outputs/supabase-enable-address-book.sql`
3. `outputs/supabase-enable-bol-and-deposit.sql`
4. `outputs/supabase-fix-bol-retry.sql`
5. `outputs/supabase-enable-login-and-customers.sql`
6. `outputs/supabase-enable-settings.sql`
7. `outputs/supabase-complete-sidebar-features.sql`
8. `outputs/supabase-correct-qianyushi-name.sql`

为什么要按顺序：

- Quote 是 Address、Deposit 和客户归属的基础。
- Deposit 脚本先创建单账户模型。
- Login/Customers 脚本再把它升级为每客户独立账户，并替换资金 RPC。
- Settings/Sidebar 脚本补齐管理功能。
- 最后一份 SQL 统一更正公司显示名称。

## 4. 成功后的主要对象

Tables：

- `customers`
- `app_users`
- `saved_quotes`
- `address_book`
- `deposit_accounts`
- `deposit_transactions`
- `platform_settings`

Functions：

- `reserve_quote_for_bol(uuid, uuid, uuid)`
- `complete_quote_bol(uuid, text, text, text, text, text)`
- `release_quote_bol_reservation(uuid, uuid, uuid)`
- `void_quote_and_refund(uuid, uuid, uuid)`
- `adjust_deposit_balance(uuid, numeric, text, uuid)`

## 5. 数据库验证 SQL

以下是只读检查，可以一次执行：

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'customers', 'app_users', 'saved_quotes', 'address_book',
    'deposit_accounts', 'deposit_transactions', 'platform_settings'
  )
order by table_name;

select routine_name, specific_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'reserve_quote_for_bol', 'complete_quote_bol',
    'release_quote_bol_reservation', 'void_quote_and_refund',
    'adjust_deposit_balance'
  )
order by routine_name, specific_name;
```

应返回 7 张表以及上述函数。因为历史兼容脚本可能保留旧签名的重载函数，看到同名多个 `specific_name` 不一定是错误；应用使用的是带 `customer_id` 的新签名。

## 6. 获取项目连接信息

Supabase Dashboard：

1. 打开目标 Project。
2. 打开 Settings → API Keys。
3. 复制 Project URL。
4. 复制 Publishable/Anon Key。
5. 复制 Server Secret/Service Role Key。

写入本机 `.env.local`：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
```

注意：

- `.env.local` 已被 `.gitignore` 排除。
- `SUPABASE_SECRET_KEY` 绝不能出现在 GitHub、截图、前端代码或聊天公开内容中。
- 如果密钥曾经上传，必须在 Supabase 立即轮换，删除 GitHub 文件并不能让旧密钥失效。

## 7. 首次管理员

1. 完成 SQL 和环境变量。
2. 启动项目。
3. 打开首页。
4. 如果 `app_users` 为空，系统显示创建首位管理员。
5. 输入姓名、Email 和不少于 8 位的临时密码。
6. 创建后使用该账号登录。

首次管理员创建会：

- 在 Supabase Auth 创建用户。
- 在 `app_users` 创建 Admin Profile。
- 绑定内部 QIANYUSHI Customer。

## 8. Auth 配置建议

在 Supabase Authentication 设置中：

- 内部测试可关闭 Email Confirmation，方便管理员直接创建账号。
- 生产环境是否启用 Email Confirmation 需根据用户开户流程决定。
- Site URL 填正式网站地址。
- Redirect URLs 添加本地和正式网站地址。
- 不要开放用户自行注册，除非后续明确设计注册审批流程。

## 9. RLS 与访问方式

项目当前设计为：

- 表启用 Row Level Security。
- anon 和 authenticated 不能直接操作业务表。
- Next.js 服务端使用 `SUPABASE_SECRET_KEY` 通过 REST/RPC 访问。
- Next.js 根据登录 Profile 和当前客户 Cookie在服务端增加客户过滤。

这意味着前端浏览器不能直接写表。新增 API 时必须继续执行服务端授权检查，不能为了方便开放宽泛 RLS Policy。

## 10. 押金初始化

新客户创建后应自动拥有余额为 0 的 Deposit Account。管理员进入 Customers 选择客户，再进入 Deposit 添加测试或实际入款。

每次调整必须写 Reason，例如：

```text
Wire received 2026-09-13 / Ref 12345
Sandbox QA funding
Manual correction approved by Cathy
```

禁止直接在 Table Editor 修改 `available_balance`，否则 Deposit Transactions 不完整，账本无法审计。

## 11. 数据备份与恢复

生产建议：

- 启用 Supabase 自动备份。
- 数据库结构改变前手工创建备份。
- 定期导出 `customers`、`app_users`、`saved_quotes`、`deposit_accounts` 和 `deposit_transactions`。
- 恢复后核对每个客户的余额是否等于该客户全部交易金额之和。

余额审计示例：

```sql
select
  a.customer_id,
  a.available_balance,
  coalesce(sum(t.amount), 0) as transaction_total
from public.deposit_accounts a
left join public.deposit_transactions t on t.customer_id = a.customer_id
group by a.customer_id, a.available_balance
order by a.customer_id;
```

在没有期初余额遗漏的情况下，`available_balance` 应与 `transaction_total` 相同。历史迁移数据可能有期初余额，需要单独记录和核对。

## 12. 常见问题

### 页面显示 fetch failed

- 检查 `.env.local` 的 URL 和 Keys。
- 检查本机是否能访问 Supabase。
- 修改 `.env.local` 后重启 Next.js。
- 检查 Secret Key 是否过期或被轮换。

### 显示 Run the customer login SQL first

没有执行 `supabase-enable-login-and-customers.sql`，或执行失败。

### 无法调整押金

- 检查 Login/Customers 和 Sidebar SQL 是否都成功。
- 检查当前账号是否 Admin/Operations。
- 检查当前是否已经选择一个客户。
- 检查负数调整是否会使余额小于 0。

### Quote 可以保存但不能 Generate BOL

- 检查客户 `can_self_book`。
- 检查可用押金。
- 检查 Quote 状态是否仍是 `draft`。
- 检查承运商环境变量。
- 检查 Reference/PO。

### SQL 显示 Success. No rows returned

对于 `CREATE`、`ALTER`、`UPDATE` 或函数定义，这是正常结果，表示命令执行成功但没有查询结果集。
