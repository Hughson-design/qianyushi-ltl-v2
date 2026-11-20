import "server-only";
import { createHmac } from "node:crypto";
import { supabaseRpc } from "./supabase-server";

export async function permitLogin(request: Request, email: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return false;
  // Vercel overwrites x-forwarded-for; never trust it on an arbitrary host.
  const ip = process.env.VERCEL === "1" ? (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim() : "local";
  const digest = (value: string) => createHmac("sha256", secret).update(value).digest("hex");
  const response = await supabaseRpc("consume_login_attempt", { p_ip_key: digest(`ip:${ip}`), p_account_key: digest(`account:${email}`) });
  if (!response.ok) throw new Error("Login protection is unavailable. Ask an administrator to check the security migration.");
  return (await response.json()) === true;
}
