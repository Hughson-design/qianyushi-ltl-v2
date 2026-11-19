# TQL 连接配置

凭据只存 Vercel 的 Production 环境变量，不写入 GitHub 或浏览器。配置后重新部署。

| 变量 | 值 |
| --- | --- |
| TQL_AUTH_MODE | 新版无独立 Secret 时设为 `public`；旧版为 `legacy` |
| TQL_AUTH_URL | `https://public.api.tql.com/identity/token` |
| TQL_API_BASE | `https://public.api.tql.com/ltl` |
| TQL_CLIENT_ID | TQL 附件里的完整 Client ID，不能按连字符拆分 |
| TQL_CLIENT_SECRET | 仅旧版填写 TQL 单独发放的 Secret；新版不用填 |
| TQL_SUBSCRIPTION_KEY | 附件中的 Ocp-Apim-Subscription Key |
| TQL_USERNAME | TRAX 登录用户名 |
| TQL_PASSWORD | TRAX 登录密码 |
| TQL_SCOPE | 以下权限 URL，用单个空格隔开 |
| TQL_BOL_EMAIL | 接收 BOL 的运营邮箱，下单前需要填写 |

邮件给出的权限：

```
https://tqlidentity.onmicrosoft.com/services_combined/LTLQuotes.Read https://tqlidentity.onmicrosoft.com/services_combined/LTLQuotes.Write https://tqlidentity.onmicrosoft.com/services_combined/LTLQuotes.Tender https://tqlidentity.onmicrosoft.com/services_combined/LoadTracking.Read
```

如果没有指定认证方式，代码为兼容既有配置，在配置独立 Secret 时使用 legacy，否则使用 public。新账号建议明确设置 `TQL_AUTH_MODE=public`，避免旧 Secret 残留造成误判。public 方式使用现有 password 流程但不发送 client_secret；最终是否适用于该账号，需以真实 token 请求结果或 TQL 官方确认判断。

总管理员在 Settings 底部点击“测试 TQL 认证”。此操作仅 POST 到身份认证入口，不调用报价、Tender 或其他卡车平台。成功只代表令牌可获取，不代表报价、下单、取消、跟踪已通过验证。每用户每服务器实例最多30秒测试一次，20秒超时，不自动重试。返回结果不包含凭据或令牌。

认证通过后再单独授权报价测试；不要用创建运单来检查连接。

参考：项目已有 TQL 接口说明 `outputs/tql-api-reference-extracted.txt`（旧认证流程），以及账号开通邮件中的 production token 地址和 scopes。新版与旧版差异参考集成服务商自身的 [TQL 接入指南](https://eniture.com/bigcommerce-tql-connection-instructions/)，不替代 TQL 对账号的认证说明。
