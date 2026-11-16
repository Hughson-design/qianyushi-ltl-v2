# LTL V2 客户与登录用户设置说明

适用对象为可以打开 **Customers（客户）** 页面的管理员或运营人员。

| 项目 | 用途 | 示例 |
| --- | --- | --- |
| Customer code（客户代码） | 用于识别公司账户 | `ACME-001` |
| Email（邮箱） | 员工或客户个人的登录 ID | `shipping@example.com` |
| Temporary password（临时密码） | 管理员为该登录用户设置的密码 | 至少 8 个字符 |

同一家公司可以有多个登录用户，共享该公司的地址簿、报价、运单和押金。系统会自动生成内部客户 ID 和用户 ID。

## 1. 创建客户公司

1. 登录 [LTL V2 工作台](https://qianyushi-ltl-v2.vercel.app/)，在左侧点 **Customers**。
2. 在 **Add customer（添加客户）** 填写 **Customer name** 和唯一的 **Customer code**。客户代码可用英文字母、数字、短横线和下划线，系统会转为大写。
3. 按需要填写 **Markup percent（加价百分比）** 和 **Minimum markup（最低加价）**。如果客户只需要询价，取消勾选 **Customer may generate BOL（允许客户生成 BOL）**。
4. 如果要同时创建首位用户，在 **First login user** 填写姓名、有效邮箱和至少 8 个字符的临时密码。该用户使用 **Customer** 角色。也可以留空，以后再添加用户。
5. 点击 **Create customer（创建客户）**。在 **Customer workspaces（客户账户）** 确认客户名称和代码。

## 2. 给现有客户添加登录用户

1. 在 **Customers → Add login user（添加登录用户）**，从 **Customer** 下拉框选择所属公司。
2. 填写 **Name**、**Email** 和 **Temporary password**。每位用户使用自己的邮箱。
3. 在 **Role（角色）** 选择权限。外部客户选 **Customer**。内部员工根据职责选择 **Sales**、**Operations** 或 **Admin**。Admin 和 Operations 可以进入客户和用户管理。
4. 点击 **Create login user（创建登录用户）**，在该客户的 **Login users（登录用户）** 下确认邮箱和角色。
5. 把 [登录网址](https://qianyushi-ltl-v2.vercel.app/) 和登录邮箱给用户，密码通过单独的安全渠道交付。手机用户可以打开 [快速询价页](https://qianyushi-ltl-v2.vercel.app/quick-quote)，用同一邮箱和密码登录。

## 3. 重置密码或停用用户

- **重置密码**：在 **Customers → Customer workspaces → Login users** 找到对应邮箱，在 **New password（新密码）** 输入至少 8 个字符的密码，然后点 **Initialize password（初始化密码）**。用户下一次登录时使用新密码。
- **改角色或停用用户**：在用户那一行修改 **Role** 或 **Active（启用）**，再点 **Save user（保存用户）**。停用该用户后，受保护的操作会被拒绝。

同一个邮箱在另一台设备登录后，旧会话会失效。多人协作时，给每人建立独立登录用户，并选择同一个客户账户。
