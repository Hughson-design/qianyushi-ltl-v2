"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import "./admin-deposit.css";

type CustomerDeposit = { id: string; name: string; code: string; active: boolean; availableBalance: number | null; lastDepositAmount: number | null; lastDepositAt: string | null };
type Entry = { id: string; transaction_type: string; amount: number; balance_after: number; reason: string | null; created_at: string; saved_quotes: { quote_number: string; reference: string } | null };
type History = { customer: { id: string; name: string; code: string }; availableBalance: number | null; records: Entry[]; nextOffset: number | null };

export function AdminDepositOverview({ language, refreshKey, onAdjusted }: { language: "en" | "zh"; refreshKey: number; onAdjusted: (customerId: string, balance: number) => void }) {
  const copy = (cn: string, en: string) => language === "zh" ? cn : en;
  const [customers, setCustomers] = useState<CustomerDeposit[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CustomerDeposit | null>(null);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [history, setHistory] = useState<History | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustment, setAdjustment] = useState({ amount: "", reason: "" });
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState("");
  const [adjustNotice, setAdjustNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const submitLock = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const money = (value: number | null) => value === null ? "—" : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
  const labels: Record<string, string> = { DEPOSIT: copy("充值", "Payment"), ADJUSTMENT: copy("手工调整", "Adjustment"), BOL_RESERVE: copy("出单扣款／预留", "Booking charge / reserve"), BOOKING_RELEASE: copy("预留释放", "Reservation release"), VOID_REFUND: copy("取消退款", "Cancellation refund") };

  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/deposit/customers?offset=${offset}&search=${encodeURIComponent(search)}`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load deposit overview.");
      if (!abort.signal.aborted) { setCustomers(data.customers); setNextOffset(data.nextOffset); }
    }).catch(error => { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load deposit overview."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [offset, search, refresh, refreshKey]);

  useEffect(() => {
    if (!selected) return;
    const abort = new AbortController();
    setHistory(null); setHistoryLoading(true); setHistoryError("");
    fetch(`/api/deposit/customers/${selected.id}?offset=${historyOffset}`, { cache: "no-store", signal: abort.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load deposit activity.");
      if (!abort.signal.aborted) setHistory(data);
    }).catch(error => { if (!abort.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Unable to load deposit activity."); })
      .finally(() => { if (!abort.signal.aborted) setHistoryLoading(false); });
    return () => abort.abort();
  }, [selected?.id, historyOffset, refresh, refreshKey]);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selected?.id]);

  function open(customer: CustomerDeposit) { setHistory(null); setHistoryError(""); setHistoryLoading(true); setHistoryOffset(0); setAdjustOpen(false); setAdjustment({ amount: "", reason: "" }); setAdjustError(""); setAdjustNotice(""); setUncertain(false); setSelected(customer); }
  function submitSearch(event: FormEvent) { event.preventDefault(); setOffset(0); setSearch(searchInput.trim()); setRefresh(n => n + 1); }
  async function adjustDeposit(event: FormEvent) {
    event.preventDefault();
    if (!selected || !history || history.availableBalance === null || submitLock.current || uncertain) return;
    const customerId = selected.id;
    submitLock.current = true; setAdjusting(true); setAdjustError(""); setAdjustNotice("");
    try {
      const response = await fetch("/api/deposit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...adjustment, customerId }) });
      const data = await response.json();
      if (!response.ok) {
        if (response.status >= 500) setUncertain(true);
        throw new Error(data.error || "Unable to confirm the adjustment.");
      }
      if (data.customerId !== customerId || !Number.isFinite(data.availableBalance)) throw new Error("Unable to confirm the adjustment result.");
      onAdjusted(customerId, data.availableBalance);
      setAdjustment({ amount: "", reason: "" }); setAdjustOpen(false);
      setAdjustNotice(copy("已保存，充值与使用明细已刷新。", "Saved. Deposit activity has been refreshed."));
      setHistoryOffset(0); setRefresh(n => n + 1);
    } catch (error) {
      setAdjustError(error instanceof Error ? error.message : "Unable to confirm the adjustment.");
      // An interrupted response may follow a committed update. Never auto retry.
      if (!(error instanceof Error) || error.name === "TypeError" || error.name === "SyntaxError" || error.message === "Unable to confirm the adjustment result.") setUncertain(true);
    } finally { submitLock.current = false; setAdjusting(false); }
  }

  return <section className="panel admin-deposit-overview">
    <header className="deposit-overview-heading"><div><h2>{copy("客户押金总览", "Customer deposits")}</h2><p>{copy("点击一行查看该客户的充值、扣款和退款明细。", "Select a customer to view payments, charges and refunds.")}</p></div><button type="button" onClick={() => setRefresh(n => n + 1)} disabled={loading}>{copy("刷新", "Refresh")}</button></header>
    <form className="deposit-overview-search" onSubmit={submitSearch}><input type="search" aria-label={copy("搜索客户名称或代码", "Search customer name or code")} placeholder={copy("搜索客户名称或代码", "Search customer name or code")} maxLength={100} value={searchInput} onChange={event => setSearchInput(event.target.value)} /><button type="submit">{copy("搜索", "Search")}</button><small>{copy("仅统计实际充值；退款和预留释放不计入最近充值。时间为太平洋时间（PT）。", "Latest payment excludes refunds and reservation releases. Times are Pacific Time (PT).")}</small></form>
    {error && <p role="alert" className="quotes-error">{error}</p>}
    {loading ? <p role="status" className="deposit-overview-empty">{copy("正在加载客户余额…", "Loading customer balances…")}</p> : !error && <div className="deposit-overview-scroll"><table className="deposit-overview-table"><thead><tr><th>{copy("客户", "Customer")}</th><th>{copy("最近一次充值", "Latest payment")}</th><th>{copy("充值时间（PT）", "Payment time (PT)")}</th><th>{copy("当前押金余额", "Available balance")}</th><th>{copy("明细", "Details")}</th></tr></thead><tbody>
      {customers.map(customer => <tr key={customer.id} tabIndex={0} onClick={() => open(customer)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); open(customer); } }}>
        <td><button type="button" className="deposit-customer-name">{customer.name}</button><small>{customer.code}{!customer.active && ` · ${copy("已停用", "Inactive")}`}</small></td><td className="deposit-money">{customer.lastDepositAmount === null ? <span className="deposit-muted">{copy("暂无充值", "No payment")}</span> : money(customer.lastDepositAmount)}</td><td>{time(customer.lastDepositAt)}</td><td className="deposit-money deposit-balance">{customer.availableBalance === null ? copy("未开户", "No account") : money(customer.availableBalance)}</td><td className="deposit-view-hint">{copy("明细", "Details")} →</td>
      </tr>)}
      {!customers.length && <tr><td colSpan={5} className="deposit-overview-empty">{copy("没有符合条件的客户。", "No matching customers.")}</td></tr>}
    </tbody></table></div>}
    <footer className="deposit-pagination"><span>{copy("每页最多50位客户", "Up to 50 customers per page")}</span><button type="button" disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>{copy("上一页", "Previous")}</button><button type="button" disabled={loading || Boolean(error) || nextOffset === null} onClick={() => { if (nextOffset !== null) setOffset(nextOffset); }}>{copy("下一页", "Next")}</button></footer>
    {selected && <dialog ref={dialog} className="deposit-history-dialog" onCancel={event => { if (submitLock.current) event.preventDefault(); else setSelected(null); }} onClick={event => { if (event.target === event.currentTarget && !submitLock.current) setSelected(null); }} aria-labelledby="deposit-history-title"><div className="deposit-history-content" onClick={event => event.stopPropagation()}>
      <header className="deposit-overview-heading"><div><p className="eyebrow">{copy("充值与使用明细", "DEPOSIT ACTIVITY")}</p><h2 id="deposit-history-title">{selected.name}</h2><p>{selected.code} · {copy("时间：太平洋时间（PT）", "Times: Pacific Time (PT)")}</p></div><button type="button" aria-label={copy("关闭押金明细", "Close deposit activity")} disabled={adjusting} onClick={() => setSelected(null)}>×</button></header>
      <div className="deposit-detail-balance"><span>{copy("当前押金余额", "Available balance")}</span><strong>{history ? money(history.availableBalance) : "—"}</strong><small>{copy("查看和调整均无需切换工作区；充值调整仅作用于本窗口中的客户。", "No workspace switch is needed. Adjustments apply only to the customer shown in this window.")}</small></div>
      <div className="deposit-adjust-toolbar"><button type="button" disabled={adjusting || historyLoading || !history || history.availableBalance === null || uncertain} aria-expanded={adjustOpen} onClick={() => setAdjustOpen(value => !value)}>{adjustOpen ? copy("收起充值调整", "Hide adjustment") : copy("充值／调整押金", "Add payment / adjust deposit")}</button></div>
      {adjustNotice && <p className="deposit-adjust-success" role="status">{adjustNotice}</p>}
      {adjustError && <p className="quotes-error" role="alert">{adjustError}</p>}
      {uncertain && <p className="quotes-error" role="alert">{copy("提交结果尚未确认，请先刷新并核对下方流水，勿重复提交。", "The result is unconfirmed. Refresh and check activity below before any further submission.")}</p>}
      {adjustOpen && <form className="deposit-inline-adjustment" onSubmit={adjustDeposit}>
        <p>{copy("调整客户：", "Customer: ")}<strong>{selected.name}</strong> · {selected.code}</p>
        <div><label>{copy("金额（USD）", "Amount (USD)")}<input required type="number" step="0.01" min="-999999999.99" max="999999999.99" value={adjustment.amount} disabled={adjusting || uncertain} onChange={event => setAdjustment(current => ({ ...current, amount: event.target.value }))} placeholder="1000.00" /><small>{copy("正数充值，负数扣减。", "Positive adds funds; negative deducts funds.")}</small></label><label>{copy("付款凭证／调整原因", "Payment reference / reason")}<input required maxLength={1000} value={adjustment.reason} disabled={adjusting || uncertain} onChange={event => setAdjustment(current => ({ ...current, reason: event.target.value }))} placeholder={copy("电汇、支票号码或调整说明", "Wire payment, check number or adjustment reason")} /></label></div>
        {adjustment.amount && Number.isFinite(Number(adjustment.amount)) && Number(adjustment.amount) !== 0 && <p className="deposit-adjust-preview">{copy("本次", "This will ")}{Number(adjustment.amount) > 0 ? copy("充值", "add ") : copy("扣减", "deduct ")}{money(Math.abs(Number(adjustment.amount)))}</p>}
        <button type="submit" disabled={adjusting || uncertain || historyLoading || !adjustment.reason.trim() || !Number.isFinite(Number(adjustment.amount)) || Number(adjustment.amount) === 0}>{adjusting ? copy("正在提交…", "Saving…") : copy("确认提交并记录流水", "Confirm and record adjustment")}</button>
      </form>}
      {historyError && <p role="alert" className="quotes-error">{historyError}</p>}
      {historyLoading ? <p role="status" className="deposit-overview-empty">{copy("正在加载明细…", "Loading activity…")}</p> : history && <div className="deposit-overview-scroll"><table className="deposit-history-table"><thead><tr><th>{copy("时间（PT）", "Time (PT)")}</th><th>{copy("类型／说明", "Type / details")}</th><th>{copy("金额", "Amount")}</th><th>{copy("变动后余额", "Balance after")}</th></tr></thead><tbody>{history.records.map(entry => <tr key={entry.id}><td>{time(entry.created_at)}</td><td><strong>{labels[entry.transaction_type] ?? entry.transaction_type}</strong>{entry.saved_quotes && <small>{entry.saved_quotes.quote_number}{entry.saved_quotes.reference && ` · ${entry.saved_quotes.reference}`}</small>}{entry.reason && <small>{entry.reason}</small>}</td><td className={`deposit-money ${Number(entry.amount) >= 0 ? "deposit-credit" : "deposit-debit"}`}>{Number(entry.amount) >= 0 ? "+" : "−"}{money(Math.abs(Number(entry.amount)))}</td><td className="deposit-money">{money(Number(entry.balance_after))}</td></tr>)}{!history.records.length && <tr><td colSpan={4} className="deposit-overview-empty">{copy("暂无充值或使用明细。", "No deposit activity yet.")}</td></tr>}</tbody></table></div>}
      <footer className="deposit-pagination"><button type="button" disabled={historyLoading || adjusting} onClick={() => setRefresh(n => n + 1)}>{copy("刷新", "Refresh")}</button><span>{copy("每页最多50笔", "Up to 50 entries per page")}</span><button type="button" disabled={historyLoading || adjusting || historyOffset === 0} onClick={() => setHistoryOffset(Math.max(0, historyOffset - 50))}>{copy("上一页", "Previous")}</button><button type="button" disabled={historyLoading || adjusting || !history || history.nextOffset === null} onClick={() => { if (history?.nextOffset !== null && history?.nextOffset !== undefined) setHistoryOffset(history.nextOffset); }}>{copy("下一页", "Next")}</button></footer>
    </div></dialog>}
  </section>;
}
