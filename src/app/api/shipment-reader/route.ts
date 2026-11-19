import { NextResponse } from "next/server";
import { requireAppSession } from "@/lib/auth-server";
import { xlsxSheetText } from "@/lib/xlsx-sheet-text";
import { READER_MAX_BYTES, READER_MAX_FILES, READER_MAX_TEXT, READER_MIME, readerExtension, readerInstructions, readerResult, readerSchema } from "@/lib/shipment-reader";

export const runtime = "nodejs";
export const maxDuration = 60;

const recentRequests = new Map<string, number[]>();

const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  return json({ aiAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()), maxBytes: READER_MAX_BYTES, maxFiles: READER_MAX_FILES });
}

export async function POST(request: Request) {
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
    for (const file of files) {
      if (["txt", "csv", "tsv"].includes(readerExtension(file.name))) text += `\n${await file.text()}`;
      else if (readerExtension(file.name) === "xlsx") {
        if (!useAi) return json({ error: "Excel 需要勾选 AI 识别。" }, 400);
        try { text += `\nEXCEL CELL DATA (column numbers match the header row; blank merged cells are not new shipments):\n${await xlsxSheetText(Buffer.from(await file.arrayBuffer()))}`; }
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
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_SHIPMENT_READER_MODEL?.trim() || "gpt-5.4-mini",
        store: false,
        instructions: readerInstructions,
        input: [{ role: "user", content }],
        max_output_tokens: 6000,
        text: { format: { type: "json_schema", name: "shipment_extraction", strict: true, schema: readerSchema } },
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!response.ok) return json({ error: response.status === 429 ? "AI 服务额度不足或繁忙，请联系管理员或稍后重试。" : "AI 服务未能识别资料，请检查服务配置或更换清晰文件。" }, 502);
    const payload = await response.json();
    if (payload.status !== "completed") return json({ error: "识别未完成，请减少文件或页数后重试。" }, 502);
    const output = (payload.output ?? []).flatMap((item: { content?: Array<{ type?: string; text?: string }> }) => item.content ?? []);
    if (output.some((part: { type?: string }) => part.type === "refusal")) return json({ error: "该资料未能识别，请更换文件或直接粘贴货运文字。" }, 422);
    const decoded = JSON.parse(output.filter((part: { type?: string }) => part.type === "output_text").map((part: { text?: string }) => part.text ?? "").join(""));
    if (typeof decoded.shipmentText !== "string" || typeof decoded.originalText !== "string" || !Array.isArray(decoded.warnings) || decoded.warnings.length > 100 || decoded.warnings.some((value: unknown) => typeof value !== "string" || value.length > 2000)) throw new Error("Invalid recognition result");
    const warnings: string[] = [...decoded.warnings];
    if (hasWorkbook || binaryFiles.some((file) => readerExtension(file.name) === "xls")) warnings.push("Excel 按单元格读取，每个工作表最多识别前 1,000 行；请核对每行货物与合计重量。" );
    if (hasWorkbook || binaryFiles.some((file) => ["doc", "docx", "xls"].includes(readerExtension(file.name)))) warnings.push("Word / Excel 中的嵌入图片不参与文字识别；如有图片资料，请另传截图或转成 PDF。");
    return json(readerResult(decoded.shipmentText, decoded.originalText, warnings, "ai"));
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return json({ error: "识别超时，请减少文件数量或页数后重试。" }, 504);
    return json({ error: "识别失败，请检查文件是否损坏、加密或内容过多，然后重试。" }, 400);
  }
}
