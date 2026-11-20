import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseRpc } from "./supabase-server";

export type ReaderQuota = { day: string; used: number; reserved: number; limit: number; remaining: number; blocked: boolean; resetAt: string };
function quotaValue(value: ReaderQuota): ReaderQuota {
  if (!value || value.limit !== 200000 || ![value.used, value.reserved, value.remaining].every(n => Number.isSafeInteger(n) && n >= 0) || typeof value.blocked !== "boolean" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day) || !Number.isFinite(Date.parse(value.resetAt)) || value.remaining !== Math.max(0, value.limit - value.used - value.reserved)) throw new Error("Invalid AI usage protection response.");
  return value;
}
export async function getReaderQuota(): Promise<ReaderQuota> {
  const response = await supabaseRpc("reader_ai_quota", {});
  if (!response.ok) throw new Error("AI usage protection is unavailable.");
  return quotaValue(await response.json());
}
export async function reserveReaderTokens(tokens: number): Promise<{ allowed: boolean; id?: string; quota: ReaderQuota }> {
  if (!Number.isSafeInteger(tokens) || tokens <= 0) throw new Error("Invalid token count.");
  const id = randomUUID();
  const response = await supabaseRpc("reserve_reader_ai_tokens", { p_id: id, p_tokens: tokens });
  if (!response.ok) throw new Error("AI usage protection is unavailable.");
  const result = await response.json();
  if (typeof result.allowed !== "boolean" || (result.allowed && result.id !== id)) throw new Error("Invalid AI reservation response.");
  return { ...result, quota: quotaValue(result.quota) };
}
export async function settleReaderTokens(id: string, actual: number | null, block = false): Promise<ReaderQuota> {
  const response = await supabaseRpc("settle_reader_ai_tokens", { p_id: id, p_actual: actual, p_block: block });
  if (!response.ok) throw new Error("AI usage could not be reconciled; reservation retained.");
  return quotaValue(await response.json());
}
