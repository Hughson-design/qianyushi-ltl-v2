import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth-server";
import { xlsxSheetText } from "@/lib/xlsx-sheet-text";
import { READER_MODEL, READER_MAX_BYTES, READER_MAX_FILES, READER_MAX_TEXT, READER_MIME, readerExtension, readerInstructions, readerResult, readerSchema } from "@/lib/shipment-reader";
import { getReaderQuota, reserveReaderTokens, settleReaderTokens } from "@/lib/ai-budget";

export const runtime = "nodejs";
export const maxDuration = 60;

const recentRequests = new Map<string, number[]>();

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  const aiAvailable = Boolean(process.env.OPENAI_API_KEY?.trim());
  try { return json({ aiAvailable, model: READER_MODEL, quota: aiAvailable ? await getReaderQuota() : null, maxBytes: READER_MAX_BYTES, maxFiles: READER_MAX_FILES }); }
  catch { return json({ aiAvailable, model: READER_MODEL, quotaUnavailable: true, maxBytes: READER_MAX_BYTES, maxFiles: READER_MAX_FILES }); }
}

export async function POST(request: Request) {
  let reservationId: string | null = null;
  let settled = false;
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const requestOrigin = request.headers.get("origin");
    if (requestOrigin && requestOrigin !== new URL(request.url).origin) return json({ error: "请从本站提交资料。" }, 403);
    if (Number(request.headers.get("content-length")) > READER_MAX_BYTES + 100_000) return json({ error: "文件总大小不能超过 2.5 MB。" }, 413);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data")) return json({ error: "上传格式不正确。" }, 400);
    const form = await request.formData();
    const rawText = form.get("text");
    if (rawText !== null && typeof rawText !== "string") return json({ error: "Invalid text input." }, 400);
    let text = String(rawText ?? "").trim();
    const useAi = form.get("useAi") === "true";
    const suppliedFiles = form.getAll("files");
    if (suppliedFiles.some((file) => !(file instanceof File))) return json({ error: "Invalid file input." }, 400);
    const files = suppliedFiles as File[];
    if (files.length > READER_MAX_FILES || files.reduce((sum, file) => sum + file.size, Buffer.byteLength(text)) > READER_MAX_BYTES) return json({ error: "每次最多 5 个文件，文件和文字合计不能超过 2.5 MB。" }, 413);
    if (text.length > READER_MAX_TEXT) return json({ error: "文字过长，请分段提交。" }, 413);
    if (!text && !files.length) return json({ error: "请粘贴文字、图片或选择文件。" }, 400);
    for (const file of files) {
      if (!file.size || !READER_MIME[readerExtension(file.name)]) return json({ error: "文件为空或格式不支持，请使用图片、PDF、Word、Excel 或文本文件。" }, 400);
    }
    const binaryFiles: File[] = [];
    let hasWorkbook = false;
    let verifiedFreight: string | null = null;
    for (const file of files) {
      if (["txt", "csv", "tsv"].includes(readerExtension(file.name))) text += `\n${await file.text()}`;
      else if (readerExtension(file.name) === "xlsx") {
        if (!useAi) return json({ error: "Excel 需要勾选 AI 识别。" }, 400);
        try {
          const workbook = await xlsxSheetText(Buffer.from(await file.arrayBuffer()));
          text += `\nEXCEL CELL DATA (column numbers match the header row; blank merged cells are not new shipments):\n${workbook.text}`;
          if (files.length === 1 && !String(rawText ?? "").trim()) verifiedFreight = workbook.freight;
        }
        catch { return json({ error: "无法读取 Excel 单元格，请使用未加密的 .xlsx 文件，或截取一票货物后重试。" }, 400); }
        hasWorkbook = true;
      }
      else binaryFiles.push(file);
    }
    if (text.length > READER_MAX_TEXT) return json({ error: "文件文字过多，请截取一票货物的内容后提交。" }, 413);
    if (!useAi) {
      if (binaryFiles.length) return json({ error: "图片、PDF、Word 和 Excel 需要勾选 AI 识别。" }, 400);
      return json(readerResult(text, text, [], "rules"));
    }
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) return json({ error: "AI 识别尚未启用，请由管理员配置 OPENAI_API_KEY。文字可先使用普通解析。" }, 503);
    try {
      const quota = await getReaderQuota();
      if (quota.blocked || quota.remaining < 6512) return json({ code: "AI_DAILY_LIMIT", quota, error: "今日 AI 保护额度已用完或余量不足，已暂停 AI 识别，不会自动转为付费。可在每日 UTC 00:00 重置后再试，或取消勾选 AI 使用普通文字解析。" }, 402);
    } catch { return json({ code: "AI_BUDGET_UNAVAILABLE", error: "AI 用量保护暂不可用，已停止发送识别请求。请联系管理员检查数据库。" }, 503); }
    // Best-effort per-instance throttling; account-level budgets should also be set at the API provider.
    const identity = String(auth.session.userId);
    const now = Date.now();
    for (const [key, times] of recentRequests) if (!times.some((time) => now - time < 60_000)) recentRequests.delete(key);
    const recent = (recentRequests.get(identity) ?? []).filter((time) => now - time < 60_000);
    if (recent.length >= 6) return json({ error: "识别过于频繁，请稍后再试。" }, 429);
    recentRequests.set(identity, [...recent, now]);
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: text || "请识别附件中的一票货运资料。" }];
    for (const file of binaryFiles) {
      const mime = READER_MIME[readerExtension(file.name)];
      const bytes = Buffer.from(await file.arrayBuffer());
      const data = `data:${mime};base64,${bytes.toString("base64")}`;
      content.push(mime.startsWith("image/") ? { type: "input_image", image_url: data, detail: "high" }
        : { type: "input_file", filename: file.name.replace(/[^\w.\-]/g, "_").slice(-100), file_data: data });
    }
    const aiRequest = {
      model: READER_MODEL,
      instructions: readerInstructions,
      input: [{ role: "user", content }],
      reasoning: { effort: "low" },
      text: { format: { type: "json_schema", name: "shipment_extraction", strict: true, schema: readerSchema } },
    };
    // Count the exact same input/schema, then atomically reserve input + maximum output.
    const countResponse = await fetch("https://api.openai.com/v1/responses/input_tokens", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequest), signal: AbortSignal.timeout(15_000),
    });
    const count = await countResponse.json().catch(() => null);
    if (!countResponse.ok && ["insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "usage_limit_reached"].includes(String(count?.error?.code || count?.error?.type || ""))) return json({ code: "AI_PROVIDER_QUOTA_EXHAUSTED", error: "OpenAI 账户额度不足或已达到消费上限，已停止 AI 识别，请联系管理员。" }, 402);
    if (!countResponse.ok || !Number.isSafeInteger(count?.input_tokens) || count.input_tokens < 0) return json({ code: "AI_COUNT_UNAVAILABLE", error: "无法安全计算本次用量，已停止 AI 识别。请稍后重试或联系管理员检查模型权限。" }, 503);
    let reservation;
    try { reservation = await reserveReaderTokens(count.input_tokens + 6000 + 512); }
    catch { return json({ code: "AI_BUDGET_UNAVAILABLE", error: "AI 用量保护暂不可用，未发送识别请求。" }, 503); }
    if (!reservation.allowed || !reservation.id) return json({ code: "AI_DAILY_LIMIT", quota: reservation.quota, error: "本次资料预计用量超过今日剩余保护额度，已停止发送，不会自动转为付费。请在 UTC 00:00 重置后再试，或减少资料。" }, 402);
    reservationId = reservation.id;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...aiRequest, store: false, max_output_tokens: 6000 }),
      signal: AbortSignal.timeout(35_000),
    });
    const payload = await response.json().catch(() => null);
    const quotaExceeded = ["insufficient_quota", "billing_hard_limit_reached", "billing_not_active", "usage_limit_reached"].includes(String(payload?.error?.code || payload?.error?.type || ""));
    const actual = Number.isSafeInteger(payload?.usage?.total_tokens) && payload.usage.total_tokens >= 0 ? payload.usage.total_tokens : (!response.ok && [400, 401, 403, 404, 422, 429].includes(response.status) ? 0 : null);
    let quota;
    try { quota = await settleReaderTokens(reservationId, actual, quotaExceeded); settled = true; }
    catch { return json({ code: "AI_BUDGET_UNAVAILABLE", error: "本次 AI 用量暂未核对，已保留额度预留。请稍后再试，勿连续重复提交。" }, 503); }
    if (!response.ok) return json({ code: quotaExceeded ? "AI_PROVIDER_QUOTA_EXHAUSTED" : response.status === 429 ? "AI_RATE_LIMIT" : "AI_PROVIDER_ERROR", quota, error: quotaExceeded ? "OpenAI 账户额度不足或已达到消费上限，本站今日 AI 已暂停，请联系管理员。不会自动更换付费模型。" : response.status === 429 ? "AI 服务请求过于频繁，请稍后重试；这不代表每日免费额度已用完。" : "AI 服务未能识别资料，请检查模型权限或更换清晰文件。" }, quotaExceeded ? 402 : response.status === 429 ? 429 : 502);
    if (!payload) return json({ error: "AI 返回格式异常，额度已保守记录，请稍后再试。", quota }, 502);
    if (payload.status !== "completed") return json({ error: "识别未完成，请减少文件或页数后重试。" }, 502);
    const output = (payload.output ?? []).flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []);
    if (output.some((part: { type?: string }) => part.type === "refusal")) return json({ error: "该资料未能识别，请更换文件或直接粘贴货运文字。" }, 422);
    const decoded = JSON.parse(output.filter((part: { type?: string }) => part.type === "output_text").map((part: { text?: string }) => part.text ?? "").join(""));
    if (typeof decoded.shipmentText !== "string" || typeof decoded.originalText !== "string" || !Array.isArray(decoded.warnings) || decoded.warnings.length > 100 || decoded.warnings.some((value: unknown) => typeof value !== "string" || value.length > 2000)) throw new Error("Invalid recognition result");
    const warnings: string[] = [...decoded.warnings];
    if (hasWorkbook || binaryFiles.some((file) => readerExtension(file.name) === "xls")) warnings.push("Excel 按单元格读取，每个工作表最多识别前 1,000 行；请核对每行货物与合计重量。" );
    if (hasWorkbook || binaryFiles.some((file) => ["doc", "docx", "xls"].includes(readerExtension(file.name)))) warnings.push("Word / Excel 中的嵌入图片不参与文字识别；如有图片资料，请另传截图或转成 PDF。");
    let shipmentText = decoded.shipmentText;
    if (verifiedFreight && /^提货地址：[^\n]+\n收货地址：[^\n]+(?:\n|$)/.test(shipmentText)) {
      shipmentText = [...shipmentText.split(/\r?\n/).slice(0, 2), verifiedFreight].join("\n");
      warnings.push("货物数量、尺寸和重量已按 Excel 明细单元格计算，并与整票总重量核对一致；请确认包装及地址服务要求。");
    }
    return json({ ...readerResult(shipmentText, decoded.originalText, warnings, "ai"), model: READER_MODEL, quota });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return json({ error: "识别超时，请减少文件数量或页数后重试。" }, 504);
    return json({ error: "识别失败，请检查文件是否损坏、加密或内容过多，然后重试。" }, 400);
  } finally {
    if (reservationId && !settled) {
      // A timeout may still be billed. Retain the full allowance, never assume zero usage.
      try { await settleReaderTokens(reservationId, null); } catch { /* Durable reservation remains held. */ }
    }
  }
}
