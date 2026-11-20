"use client";

import { useState } from "react";

export function TqlConnectionTest({ language }: { language: "zh" | "en" }) {
  const zh = language === "zh";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [audit, setAudit] = useState<{ mode: string; missing: string[]; checks: Record<string, boolean> } | null>(null);
  const auditLabels: Record<string, string> = {
    authEndpointMatchesEmail: zh ? "认证地址与 TQL 邮件一致" : "Token endpoint matches the TQL email",
    apiBaseMatchesProduction: zh ? "货运接口为生产地址" : "Freight API uses the production address",
    scopesMatchEmail: zh ? "四项权限与 TQL 邮件一致" : "All four scopes match the TQL email",
    clientIdIsSingleUuid: zh ? "Client ID 是完整单个 UUID" : "Client ID is one complete UUID",
    subscriptionKeyHasNoWhitespace: zh ? "订阅密钥已填写且无内部空格" : "Subscription key is present without internal spaces",
    noCredentialPlaceholders: zh ? "凭据没有保留示例占位文字" : "Credentials do not contain example placeholders",
    passwordHasNoEdgeWhitespace: zh ? "密码首尾没有多余空格" : "Password has no leading or trailing whitespace",
    scopeUsesSingleSpaces: zh ? "权限之间使用单个空格" : "Scopes are separated by single spaces",
  };
  async function checkConfiguration() {
    if (busy) return;
    setBusy(true); setMessage(""); setAudit(null);
    try {
      const response = await fetch("/api/settings/tql/test", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check configuration.");
      setAudit(data);
    } catch (error) { setSuccess(false); setMessage(error instanceof Error ? error.message : "Unable to check configuration."); }
    finally { setBusy(false); }
  }
  async function test() {
    if (busy) return;
    setBusy(true); setMessage(""); setSuccess(false);
    try {
      const response = await fetch("/api/settings/tql/test", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const data = await response.json();
      if (!response.ok || !data.authenticated) throw new Error(Array.isArray(data.missing) && data.missing.length ? `${zh ? "请在 Vercel 补充：" : "Configure in Vercel: "}${data.missing.join(", ")}` : data.error || "TQL authentication failed.");
      setSuccess(true);
      setMessage(zh ? `TQL 认证成功（${data.mode === "public" ? "新版" : "旧版"}）。仅获取了令牌，尚未验证报价或下单权限。` : `TQL authentication succeeded (${data.mode}). Only the token was tested; rates and booking permissions have not been verified.`);
    } catch (error) { setMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message : zh ? "测试未完成，请稍后重试。" : "Test did not complete. Please try again later."); }
    finally { setBusy(false); }
  }
  return <section className="panel settings-panel" style={{ marginTop: 16 }}>
    <h2>{zh ? "TQL 连接检查" : "TQL connection check"}</h2>
    <p style={{ fontSize: 13 }}>{zh ? "检查服务器凭据并获取认证令牌，不发送货物资料、不询价、不生成运单。凭据只在 Vercel 中填写。" : "Checks server credentials and requests a token. No shipment data, rate requests, or bookings are sent. Enter credentials in Vercel only."}</p>
    <button type="button" onClick={() => void test()} disabled={busy}>{busy ? (zh ? "正在检查…" : "Checking…") : (zh ? "测试 TQL 认证" : "Test TQL authentication")}</button>
    <button type="button" onClick={() => void checkConfiguration()} disabled={busy} style={{ marginLeft: 12 }}>{zh ? "核对线上配置" : "Check deployed configuration"}</button>
    {audit && <div role="status" style={{ fontSize: 13 }}><p>{zh ? "认证方式：" : "Authentication mode: "}{audit.mode} · {zh ? "缺少字段：" : "Missing fields: "}{audit.missing.join(", ") || (zh ? "无" : "none")}</p><p>{zh ? "以下检查仅确认格式和配置，不验证密码或密钥是否正确。" : "These checks validate configuration and format, not whether credential values are correct."}</p><ul>{Object.entries(audit.checks).map(([name, passed]) => <li key={name}>{passed ? "✓" : "⚠"} {auditLabels[name] || name}</li>)}</ul></div>}
    {message && <p className={success ? "settings-success" : "quotes-error"} role="status">{message}</p>}
  </section>;
}
