# 2026-11-20 安全修复与上线说明

## 必须先执行的数据库步骤

在已有安装的生产库执行 `outputs/supabase-security-hardening.sql`，再部署代码。该事务更新预留/释放流水函数并安装共享数据库登录限流，不改真实余额或已有运单。登录限流若不可用会拒绝登录，不能先部署代码再补 SQL。

执行 `outputs/verify-security-hardening.sql`：临时表模拟两轮扣款/释放，验证余额和四笔流水；同时验证登录第 11 次被拒绝、普通客户端无权调用限流函数。全部在事务内回滚，不操作真实运单。

2026-11-20 已在生产库完成上述迁移和回滚验证。只读确认单设备登录、历史记录及用户名、邮箱修改、Mothership 设置和重试流水修复均已安装。新库完整安装顺序见 README。

## 出单与核对

- 新草稿标记 bookingVersion=2，报价到期时间参与签名，过期先重新报价。
- Priority1 的恢复标识为 `QY-` 加完整 Quote UUID（去连字符），共 35 字符。用户 PO 仍在网站保留，不能用于承运商恢复匹配。
- 已知联系人、货物、邮件等缺失在资金预留前拒绝。开始出单后的任何异常保留 booking 和押金预留，禁止再次创建。
- 总管理员在 Quotes 点“核对已有运单”：仅查询已有运单/文件，不调用 dispatch/tender，不再次扣款。找不到、多个匹配、Reference 不匹配或 BOL 不齐全则继续保留待核对。
- 核对不是自动退款按钮。只有运营人员向承运商确认未创建或完成取消后，才能人工按客户、Quote 和流水核实释放资金；不得仅凭 HTTP 错误或超时释放。
- 旧草稿、旧待核对记录不具备新安全标识，禁止自动恢复/出单；旧 Priority1 运单也禁止网站直接取消。先人工核查承运商，不能直接复制后重下。
- 客户没有自行出单权限时，也禁止其自行取消。独立取消权限可作为后续业务扩展。

## 登录、安全头与数据

- 登录按账户及 Vercel 提供的客户端 IP 分别使用 15 分钟计数（账户 10 次、IP 30 次）。存入数据库的是带密钥哈希，不保存明文邮箱或 IP。数据库不可用时拒绝登录。
- 过期令牌通过 Refresh Token 续期，但不能改写 active_session_id；新设备登录或退出后的旧会话不能续期恢复访问。退出时按会话 ID 条件清除并调用 Supabase 本会话退出。
- 设置 GET 对普通用户只返回填写下单资料所需的公司/联系人/时间，不返回默认加价与渠道开关。
- 新下单资料采用字段白名单、长度、必填、电话及时间校验；地址编辑重算 fingerprint；常见数据库错误只返回安全提示。
- 全站添加 frame-ancestors、X-Frame-Options、nosniff、Referrer-Policy 和 CSP。Next.js 当前内联脚本仍使用 unsafe-inline，未来可采用 nonce 收紧；不能宣称 CSP 已防御所有 XSS。
- 用户选择暂不自动删除 SMART QUOTE 原文。本次没有删除历史资料，也未安装自动清理任务。

## 尚需外部配置核对

1. Vercel 设置独立 `QUOTE_SIGNING_KEY`，使用至少 32 字节随机值，Secret、Production；保存后重新部署。首次设置兼容现有 Supabase 签名，后续轮换用 QUOTE_PREVIOUS_SIGNING_KEY 临时保留上一签名密钥。清空所有使用旧密钥的 booking 前不能移除其验证密钥。未配置独立密钥时仍暂时兼容 Supabase Secret，不能因此宣称密钥已解耦。
2. Supabase Authentication 启用修改密码时要求当前密码。网站已传递 current_password，2026-11-20 已在生产后台启用并确认保存成功。官方说明：https://supabase.com/docs/guides/auth/password-security
3. 本次测试不创建或取消真实运单。异常后的最终承运商状态和人工释放资金流程仍须按真实记录核对。

验证：`node --test tests/*.test.cjs`、`pnpm build`；测试使用模拟承运商，数据库测试采用临时表和回滚。
