"use client";
import { useEffect, useState, type FormEvent } from "react";
import "./booking-release.css";

type Review = { quote: { quoteNumber: string; reference: string; customerName: string; price: number; status: string; availableAt: string; canRelease: boolean }; records: { id: string; created_at: string; action: string; reason: string; amount: number; actor_email: string; actor_name: string }[] };
export function BookingReleaseDialog({ quoteId, language, onClose, onReleased }: { quoteId: string; language: "zh" | "en"; onClose: () => void; onReleased: (released: boolean) => void }) {
  const copy = (cn: string, en: string) => language === "zh" ? cn : en;
  const [review, setReview] = useState<Review | null>(null);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReview(null); setError("");
    fetch(`/api/quotes/${quoteId}/release`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load reservation.");
      if (!controller.signal.aborted) setReview(data);
    }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load reservation."); });
    return () => controller.abort();
  }, [quoteId, reload]);
  async function release(event: FormEvent) {
    event.preventDefault();
    if (busy || !review?.quote.canRelease || !confirmed || reason.trim().length < 10) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/quotes/${quoteId}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, confirmedNoShipment: confirmed }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to release reservation.");
      onReleased(data.released === true);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to verify release status. Refresh before retrying."); }
    finally { setBusy(false); }
  }
  const money = (n: number) => Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return <div className="address-book-backdrop" onMouseDown={() => { if (!busy) onClose(); }}>
    <section className="booking-release-dialog" role="dialog" aria-modal="true" aria-labelledby="release-review-title" onMouseDown={event => event.stopPropagation()}>
      <header><div><p className="eyebrow">{copy("预留核对与审计", "RESERVATION REVIEW")}</p><h2 id="release-review-title">{copy("确认未建单后释放", "Release after confirming no shipment")}</h2></div><button type="button" disabled={busy} onClick={onClose} aria-label={copy("关闭", "Close")}>×</button></header>
      {error && <p role="alert" className="quotes-error">{error}</p>}
      {!review ? <p>{copy("正在加载核对资料…", "Loading reservation…")}</p> : <>
        <dl><div><dt>{copy("所属客户", "Owning customer")}</dt><dd>{review.quote.customerName}</dd></div><div><dt>{copy("报价单", "Quote")}</dt><dd>{review.quote.quoteNumber}</dd></div><div><dt>Reference / PO</dt><dd>{review.quote.reference}</dd></div><div><dt>{copy("预留金额", "Reservation amount")}</dt><dd>{money(review.quote.price)}</dd></div></dl>
        {review.quote.status === "booking" && <form onSubmit={release}>
          <p className="release-warning">{copy("请先在承运商平台查询或联系承运商，确认没有有效运单及提货安排。这里仅释放本站押金，不会取消承运商订单。", "Check the carrier portal or contact the carrier first to confirm no active shipment or pickup exists. This releases the site deposit; it does not cancel a carrier order.")}</p>
          {!review.quote.canRelease && <p role="status">{copy("目前不可释放。下单开始后至少等待五分钟；如已有运单标识，请按取消流程处理。可释放时间：", "Release unavailable. Wait at least five minutes after booking starts. Existing shipment identifiers require cancellation instead. Earliest release: ")}{new Date(review.quote.availableAt).toLocaleString()}</p>}
          <label>{copy("核对依据及释放原因（10—1000字）", "Evidence and reason (10–1000 characters)")}<textarea required minLength={10} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder={copy("例如：核对时间、查询依据、承运商确认人员或工单号。", "Include the check time, lookup evidence, carrier contact or support ticket.")} /></label>
          <label className="release-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{copy("我已确认不存在有效运单及提货安排，并对上述核对依据负责。", "I confirmed no active shipment or pickup exists and take responsibility for the evidence above.")}</label>
          <button type="submit" className="release-submit" disabled={busy || !review.quote.canRelease || !confirmed || reason.trim().length < 10}>{busy ? copy("正在释放…", "Releasing…") : copy("确认释放并保存审计记录", "Release and save audit record")}</button>
        </form>}
        <h3>{copy("释放审计记录", "Release audit")}</h3>
        {!review.records.length ? <p>{copy("尚无释放记录。", "No release records.")}</p> : <ol className="release-audit">{review.records.map(record => <li key={record.id}><strong>{record.action === "AUTO_RELEASE" ? copy("自动释放", "Automatic release") : copy("管理员确认释放", "Administrator release")} · {money(record.amount)}</strong><small>{new Date(record.created_at).toLocaleString()} · {record.actor_name || record.actor_email}</small><p>{record.reason}</p></li>)}</ol>}
      </>}
      <footer><button type="button" disabled={busy} onClick={() => { setConfirmed(false); setReload(value => value + 1); }}>{copy("刷新状态", "Refresh status")}</button><button type="button" disabled={busy} onClick={onClose}>{copy("关闭", "Close")}</button></footer>
    </section>
  </div>;
}
