"use client";

import { useState } from "react";

export function TqlConnectionTest({ language }: { language: "zh" | "en" }) {
  const zh = language === "zh";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
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
    {message && <p className={success ? "settings-success" : "quotes-error"} role="status">{message}</p>}
  </section>;
}
