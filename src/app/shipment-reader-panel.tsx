"use client";

import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { READER_ACCEPT, READER_MAX_BYTES, READER_MAX_FILES, READER_MAX_TEXT, READER_MIME, readerExtension, type ReaderResult } from "@/lib/shipment-reader";
import { parseSmartQuote, type SmartQuoteResult, type SmartFreightItem } from "@/lib/smart-quote-parser";

type Attachment = { id: string; file: File; url: string; preview?: string };
type Props = { language: "zh" | "en"; onUse: (result: SmartQuoteResult, text: string) => void };
type EditableFreight = SmartFreightItem & { dimensionUnit: string; weightUnit: string };
const blankFreight = (): EditableFreight => ({ packaging: "Pallet", pallets: "1", pieces: "1", length: "", width: "", height: "", unitWeight: "", commodity: "", nmfc: "", declaredValue: "", stackable: true, hazmat: false, dimensionUnit: "in", weightUnit: "lb" });

export function ShipmentReaderPanel({ language, onUse }: Props) {
  const zh = language === "zh";
  const copy = (cn: string, en: string) => zh ? cn : en;
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentsRef = useRef<Attachment[]>([]);
  const [result, setResult] = useState<ReaderResult | null>(null);
  const [reviewText, setReviewText] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [freightEdits, setFreightEdits] = useState<EditableFreight[]>([]);
  const [freightDirty, setFreightDirty] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const parsed = useMemo(() => parseSmartQuote(reviewText), [reviewText]);
  const totalBytes = attachments.reduce((sum, item) => sum + item.file.size, new TextEncoder().encode(text).length);
  const hasBinary = attachments.some((item) => !["txt", "csv", "tsv"].includes(readerExtension(item.file.name)));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/shipment-reader", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data) => setAiAvailable(Boolean(data.aiAvailable)))
      .catch(() => { if (!controller.signal.aborted) setAiAvailable(false); });
    return () => {
      controller.abort(); abort.current?.abort(); sequence.current += 1;
      for (const item of attachmentsRef.current) URL.revokeObjectURL(item.url);
    };
  }, []);

  function invalidate() { setResult(null); setReviewText(""); setReviewed(false); setError(""); setFreightEdits([]); setFreightDirty(false); }
  function loadFreight(value: string) {
    const items = parseSmartQuote(value).items;
    setFreightEdits(items.length ? items.map((item) => ({ ...item, dimensionUnit: "in", weightUnit: "lb" })) : [blankFreight()]);
    setFreightDirty(false);
  }
  function editFreight(index: number, field: keyof EditableFreight, value: string) {
    setFreightEdits((items) => items.map((item, i) => i === index ? { ...item, [field]: value } : item));
    setFreightDirty(true); setReviewed(false);
  }
  function applyFreight() {
    const addresses = reviewText.split(/\r?\n/).slice(0, 2);
    const lines = freightEdits.map((item) => `quantity: ${item.pallets || 0}, ${item.packaging}, ${item.pieces || 0} pieces, dimensions: ${item.length || 0}×${item.width || 0}×${item.height || 0} ${item.dimensionUnit}, weight: ${item.unitWeight || 0} ${item.weightUnit}, commodity: ${item.commodity || ""}${item.nmfc ? `, NMFC ${item.nmfc}` : ""}${item.declaredValue ? `, declared value: ${item.declaredValue}` : ""}${!item.stackable ? ", non-stackable" : ""}${item.hazmat ? ", hazmat" : ""}`);
    const next = [...addresses, ...lines].join("\n");
    setReviewText(next); setFreightDirty(false); setReviewed(false);
  }
  function replaceAttachments(next: Attachment[]) { attachmentsRef.current = next; setAttachments(next); }

  function openAttachment(item: Attachment) {
    const extension = readerExtension(item.file.name);
    if (["png", "jpg", "jpeg", "webp", "pdf", "txt"].includes(extension)) {
      window.open(item.url, "_blank", "noopener,noreferrer");
    } else {
      // Office documents need a local application; preserve the original filename.
      const link = document.createElement("a");
      link.href = item.url; link.download = item.file.name;
      document.body.appendChild(link); link.click(); link.remove();
    }
  }

  function addFiles(incoming: File[]) {
    if (busy) return;
    setError("");
    const existing = attachmentsRef.current;
    if (incoming.some((file) => !file.size || !READER_MIME[readerExtension(file.name)])) {
      setError(copy("包含空文件或不支持的格式，请选择图片、PDF、Word、Excel 或文本。", "Choose a nonempty image, PDF, Word, Excel, or text file.")); return;
    }
    if (existing.length + incoming.length > READER_MAX_FILES) { setError(copy("每次最多 5 个文件。", "Choose at most 5 files.")); return; }
    if ([...existing.map((item) => item.file), ...incoming].reduce((sum, file) => sum + file.size, new TextEncoder().encode(text).length) > READER_MAX_BYTES) {
      setError(copy("资料合计不能超过 2.5 MB，请压缩图片或减少文件。", "Keep all files and text under 2.5 MB.")); return;
    }
    const added = incoming.map((file) => {
      const extension = readerExtension(file.name);
      const url = URL.createObjectURL(file.slice(0, file.size, READER_MIME[extension]));
      return { id: crypto.randomUUID(), file, url, preview: ["png", "jpg", "jpeg", "webp"].includes(extension) ? url : undefined };
    });
    replaceAttachments([...existing, ...added]); invalidate();
  }

  function paste(event: ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault(); addFiles(files);
    const pasted = event.clipboardData.getData("text/plain");
    if (pasted && !busy) setText((current) => `${current}\n${pasted}`.trim().slice(0, READER_MAX_TEXT));
  }

  async function readClipboard() {
    if (busy) return;
    try {
      if (!navigator.clipboard?.read) throw new Error();
      const entries = await navigator.clipboard.read();
      const files: File[] = [];
      let pastedText = "";
      for (const entry of entries) {
        const imageType = entry.types.find((type) => ["image/png", "image/jpeg", "image/webp"].includes(type));
        if (imageType) {
          const blob = await entry.getType(imageType);
          files.push(new File([blob], `clipboard-${Date.now()}-${files.length}.${imageType === "image/jpeg" ? "jpg" : imageType.split("/")[1]}`, { type: imageType }));
        } else if (entry.types.includes("text/plain")) pastedText += `${await (await entry.getType("text/plain")).text()}\n`;
      }
      if (files.length) addFiles(files);
      if (pastedText) { setText((current) => `${current}\n${pastedText}`.trim().slice(0, READER_MAX_TEXT)); if (!files.length) invalidate(); }
      if (!files.length && !pastedText) throw new Error();
    } catch { setError(copy("无法直接读取剪贴板。请点击文字框按 Ctrl+V，或用上传按钮选择截图。", "Click the text box and press Ctrl+V, or upload your screenshot.")); }
  }

  async function recognize(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (totalBytes > READER_MAX_BYTES) { setError(copy("资料合计不能超过 2.5 MB。", "Keep all input under 2.5 MB.")); return; }
    setBusy(true); setError(""); setResult(null); setReviewed(false);
    const id = ++sequence.current;
    const controller = new AbortController(); abort.current = controller;
    try {
      const body = new FormData(); body.set("text", text); body.set("useAi", String(useAi));
      attachments.forEach((item) => body.append("files", item.file));
      const response = await fetch("/api/shipment-reader", { method: "POST", body, signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 ? copy("登录已过期，请刷新页面重新登录。", "Your session expired. Refresh and sign in again.") : data.error || "Unable to read the shipment.");
      if (id !== sequence.current) return;
      setResult(data); setReviewText(data.text || ""); loadFreight(data.text || "");
    } catch (error) {
      if (id === sequence.current && !controller.signal.aborted) setError(error instanceof Error ? error.message : copy("识别失败，请重试。", "Recognition failed. Please try again."));
    } finally { if (id === sequence.current) setBusy(false); }
  }

  const missingLabels: Record<string, string> = {
    "pickup address and ZIP code": "提货地址和邮编", "delivery address and ZIP code": "收货地址和邮编",
    "dimensions and weight": "货物尺寸及重量", "unrecognized freight or service line": "未识别的货物或服务行",
  };
  const validFreight = parsed.items.length > 0 && parsed.items.every((item) => [item.pallets, item.pieces, item.length, item.width, item.height, item.unitWeight].every((value) => Number.isFinite(Number(value)) && Number(value) > 0) && Number.isInteger(Number(item.pallets)) && Number.isInteger(Number(item.pieces)));
  const canUse = Boolean(result && reviewText.trim() && validFreight && !parsed.missing.length && reviewed && !busy && !freightDirty);
  return <div className="reader-page" onPaste={paste}>
    <section className="page-heading reader-heading"><div><p className="eyebrow">SHIPMENT READER</p><h1>{copy("资料识别", "Shipment reader")}</h1><p>{copy("粘贴文字、截图或上传文件，先核对，再带入询价。", "Paste text or screenshots, or upload documents. Review before quoting.")}</p></div><span className="reader-draft-pill">{copy("仅生成草稿", "Draft only")}</span></section>
    <div className="reader-layout">
      <form className="panel reader-input" onSubmit={recognize}>
        <header className="reader-section-heading"><span className="reader-step">1</span><div><h2>{copy("导入原始资料", "Add shipment details")}</h2><p>{copy("每次一票货，可同时添加多份资料。", "One shipment at a time; combine supporting files.")}</p></div></header>
        <label className="reader-text-label" htmlFor="reader-text">{copy("文字 / 截图粘贴区", "Paste text or screenshots")}</label>
        <textarea id="reader-text" value={text} maxLength={READER_MAX_TEXT} disabled={busy} onChange={(event) => { setText(event.target.value); invalidate(); }} placeholder={copy("提货地址：…\n收货地址：…\n7托盘，每托120×100×180cm，每托744kg\n或直接在这里粘贴截图（Ctrl+V）", "Pickup address: …\nDelivery address: …\n7 pallets, each 120×100×180cm, 744kg per pallet\nOr paste a screenshot here (Ctrl+V)")} />
        <div className={`reader-dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
          <span className="reader-upload-symbol" aria-hidden="true">↥</span><strong>{copy("拖入文件或选择上传", "Drop files here or upload")}</strong>
          <small>PNG · JPG · WebP · PDF · Excel · Word · TXT · CSV</small>
          <div className="reader-upload-actions"><button type="button" className="reader-secondary" disabled={busy} onClick={() => fileInput.current?.click()}>{copy("上传文件", "Upload files")}</button><button type="button" className="reader-secondary" disabled={busy} onClick={() => void readClipboard()}>{copy("粘贴剪贴板", "Paste clipboard")}</button></div>
          <small>{copy("最多5个文件，文字和文件合计2.5 MB", "Up to 5 files, 2.5 MB total including text")}</small>
          <input ref={fileInput} type="file" multiple accept={READER_ACCEPT} hidden disabled={busy} onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
        </div>
        {attachments.length > 0 && <ul className="reader-files">{attachments.map((item) => <li key={item.id}>
          <button type="button" className="reader-file-open" aria-label={`${copy("打开", "Open")} ${item.file.name}`} title={copy("双击打开原文件；Excel、Word 将下载后在本机打开", "Double-click to open; download Excel/Word to open locally")} onDoubleClick={() => openAttachment(item)} onClick={(event) => { if (event.detail === 0) openAttachment(item); }}>
            {item.preview ? <img src={item.preview} alt="" /> : <span className="reader-file-type">{readerExtension(item.file.name).toUpperCase()}</span>}
            <span className="reader-file-info"><strong>{item.file.name}</strong><small>{(item.file.size / 1000).toFixed(0)} KB · {copy("双击打开", "Double-click to open")}</small></span>
          </button>
          <button type="button" className="reader-file-action" onClick={() => openAttachment(item)}>{copy("打开", "Open")}</button>
          <button type="button" disabled={busy} aria-label={`${copy("移除", "Remove")} ${item.file.name}`} onClick={() => { URL.revokeObjectURL(item.url); replaceAttachments(attachments.filter((entry) => entry.id !== item.id)); invalidate(); }}>×</button>
        </li>)}</ul>}
        <div className="reader-ai-choice"><label><input type="checkbox" checked={useAi} disabled={busy || aiAvailable !== true} onChange={(event) => { setUseAi(event.target.checked); invalidate(); }} /><span><strong>{copy("使用 AI 理解资料", "Use AI extraction")}</strong><small>{copy("勾选后，所提交的文字及文件将发送给 OpenAI，按使用量计费。", "When selected, submitted text and files are sent to OpenAI and billed by usage.")}</small></span></label>
          {aiAvailable === false && <p>{copy("AI 尚未启用：请管理员配置 OPENAI_API_KEY。普通文字解析可先使用。", "AI is not enabled. Ask the administrator to configure OPENAI_API_KEY. Basic text parsing is available.")}</p>}
          {hasBinary && !useAi && <p>{copy("图片、扫描 PDF、Word 和 Excel 需要启用 AI 识别。", "Images, PDFs, Word, and Excel require AI extraction.")}</p>}
        </div>
        {error && <p className="reader-error" role="alert">{error}</p>}
        <div className="reader-form-actions"><button type="submit" className="reader-primary" disabled={busy || (!text.trim() && !attachments.length) || (hasBinary && !useAi)}>{busy ? copy("正在识别…", "Reading…") : copy("开始识别", "Read shipment")}</button>{busy ? <button type="button" className="reader-secondary" onClick={() => { abort.current?.abort(); sequence.current += 1; setBusy(false); }}>{copy("取消", "Cancel")}</button> : <button type="button" className="reader-secondary" disabled={!text && !attachments.length && !result} onClick={() => { for (const item of attachments) URL.revokeObjectURL(item.url); replaceAttachments([]); setText(""); invalidate(); }}>{copy("清空", "Clear")}</button>}</div>
        <p className="reader-footnote">{copy("原文件不会保存到本站数据库；只有确认后带入的询价文字会按现有询价记录规则保存。", "Original files are not saved to this site's database. Confirmed quote text follows existing quote input history rules.")}</p>
      </form>
      <section className="panel reader-output" aria-busy={busy} aria-live="polite">
        <header className="reader-section-heading"><span className="reader-step">2</span><div><h2>{copy("核对识别结果", "Review extracted details")}</h2><p>{copy("检查地址、单位、托数与每托重量。", "Check addresses, units, handling units, and weight per unit.")}</p></div></header>
        {!result ? <div className="reader-empty"><span aria-hidden="true">▤</span><h3>{busy ? copy("正在读取资料", "Reading your shipment") : copy("识别结果将显示在这里", "Your shipment preview appears here")}</h3><p>{busy ? copy("复杂表格和扫描件可能需要一些时间。", "Tables and scanned documents may take a little longer.") : copy("先添加左侧资料，然后点击“开始识别”。", "Add your details and select Read shipment.")}</p>{busy && <div className="reader-busy-bar"><i /></div>}</div> : <>
          <div className="reader-method">{result.method === "ai" ? copy("AI 识别草稿", "AI extraction draft") : copy("普通文字解析", "Basic text parsing")}</div>
          {result.warnings.length > 0 && <div className="reader-warning" role="status"><strong>{copy("需要确认", "Please verify")}</strong><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
          <label className="reader-text-label" htmlFor="reader-review">{copy("可编辑的询价文字", "Editable shipment text")}</label>
          <textarea id="reader-review" value={reviewText} maxLength={READER_MAX_TEXT} onChange={(event) => { setReviewText(event.target.value); setReviewed(false); loadFreight(event.target.value); }} />
          <section className="reader-freight-editor" aria-label={copy("修改尺寸与重量", "Edit dimensions and weights")}>
            <h3>{copy("在这里补全或修改货物", "Complete or correct freight here")}</h3>
            <p>{copy("直接填写下面的尺寸和单件重量，再点“应用货物修改”。不同尺寸或重量请分行。", "Edit dimensions and weight per handling unit below, then apply. Use separate rows for different sizes or weights.")}</p>
            {freightEdits.map((item, index) => <fieldset key={index}>
              <legend>{copy("货物", "Freight")} {index + 1}</legend>
              <div className="reader-edit-grid">
                <label>{copy("包装", "Packaging")}<select value={item.packaging} onChange={(event) => editFreight(index, "packaging", event.target.value)}>{["Pallet", "Crate", "Carton", "Bale", "Roll", "Loose"].map((value) => <option key={value}>{value}</option>)}</select></label>
                {([['pallets', copy('包装数量', 'Units')], ['pieces', copy('件数', 'Pieces')], ['length', copy('长', 'Length')], ['width', copy('宽', 'Width')], ['height', copy('高', 'Height')], ['unitWeight', copy('每包装重量', 'Unit weight')]] as const).map(([field, label]) => <label key={field}>{label}<input type="number" min="0" step={field === "pallets" || field === "pieces" ? "1" : "any"} aria-label={`${label} ${index + 1}`} value={item[field]} onChange={(event) => editFreight(index, field, event.target.value)} /></label>)}
                <label>{copy("尺寸单位", "Dimension unit")}<select aria-label={`Dimension unit ${index + 1}`} value={item.dimensionUnit} onChange={(event) => editFreight(index, "dimensionUnit", event.target.value)}><option>in</option><option>cm</option><option>m</option></select></label>
                <label>{copy("重量单位", "Weight unit")}<select aria-label={`Weight unit ${index + 1}`} value={item.weightUnit} onChange={(event) => editFreight(index, "weightUnit", event.target.value)}><option>lb</option><option>kg</option></select></label>
                <label className="reader-edit-commodity">{copy("品名", "Commodity")}<input value={item.commodity} onChange={(event) => editFreight(index, "commodity", event.target.value)} /></label>
              </div>
              <button type="button" className="reader-secondary" onClick={() => { setFreightEdits((items) => items.filter((_, i) => i !== index)); setFreightDirty(true); setReviewed(false); }}>{copy("移除此行", "Remove row")}</button>
            </fieldset>)}
            <div className="reader-form-actions"><button type="button" className="reader-secondary" onClick={() => { setFreightEdits((items) => [...items, blankFreight()]); setFreightDirty(true); setReviewed(false); }}>{copy("增加货物行", "Add freight row")}</button><button type="button" className="reader-primary" disabled={!freightDirty} onClick={applyFreight}>{copy("应用货物修改", "Apply freight changes")}</button></div>
            {freightDirty && <p role="status">{copy("有未应用的修改，请先点击“应用货物修改”。", "Apply your freight changes before using the quote.")}</p>}
            {!validFreight && !freightDirty && <p role="status">{copy("请填写大于0的长、宽、高和重量；包装数量、件数须为正整数。", "Enter positive dimensions and weight; units and pieces must be positive whole numbers.")}</p>}
          </section>
          <div className="reader-route"><article><small>{copy("提货地", "Ship from")}</small><strong>{parsed.originZip || "—"}</strong><p>{parsed.originAddress || copy("尚未识别", "Not identified")}</p></article><span aria-hidden="true">→</span><article><small>{copy("收货地", "Ship to")}</small><strong>{parsed.destinationZip || "—"}</strong><p>{parsed.destinationAddress || copy("尚未识别", "Not identified")}</p></article></div>
          {parsed.items.length > 0 && <div className="reader-table-scroll"><table className="reader-table"><thead><tr>{[copy("包装 / 托数", "Packaging / units"), copy("件数", "Pieces"), copy("尺寸 (in)", "Dimensions (in)"), copy("每托重量 (lb)", "Unit weight (lb)"), copy("总重量 (lb)", "Total weight (lb)")].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{parsed.items.map((item, index) => <tr key={index}><td>{item.packaging} × {item.pallets}</td><td>{item.pieces}</td><td>{item.length} × {item.width} × {item.height}</td><td>{item.unitWeight}</td><td>{Math.round(Number(item.pallets) * Number(item.unitWeight))}</td></tr>)}</tbody></table></div>}
          {parsed.services.length > 0 && <div className="reader-service-tags">{parsed.services.map((service) => <span key={service}>{service}</span>)}</div>}
          {parsed.conversions.length > 0 && <p className="reader-conversions">{parsed.conversions.join(" · ")}</p>}
          {parsed.missing.length > 0 && <p className="reader-error">{copy("请补全：", "Please complete: ")}{parsed.missing.map((field) => zh ? missingLabels[field] || field : field).join(" · ")}{copy("。地址请在上方询价文字框修改；尺寸和重量请在“补全或修改货物”中填写。", ". Edit addresses in the shipment text above; enter dimensions and weights in the freight editor.")}</p>}
          <label className="reader-review-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /><span>{copy("我已核对地址、尺寸、单位、托数、件数及单托/总重量，并处理上述提醒。", "I have checked the route, dimensions, units, piece/handling-unit counts, weights, and all warnings.")}</span></label>
          <button type="button" className="reader-use" disabled={!canUse} onClick={() => { if (canUse) onUse(parsed, reviewText); }}>{copy("确认并带入询价", "Use in quote")}</button>
          <p className="reader-footnote">{copy("这里只填写询价资料，不会获取价格或创建运单。", "This fills the quote form. It does not request rates or create a shipment.")}</p>
          {result.originalText && <details className="reader-transcript"><summary>{copy("查看提取原文", "View extracted source text")}</summary><pre>{result.originalText}</pre></details>}
        </>}
      </section>
    </div>
  </div>;
}
