"use client";

import { useEffect, useState } from "react";

type Record = { id: string | number; created_at: string; customer_name: string; user_name: string; user_email: string; source: string; input_text: string };
type Props = { language: "en" | "zh"; companyName: string; onUsers: () => void; onProfile: () => void; onQuotes: () => void };

export function QuoteInputHistory({ language, companyName, onUsers, onProfile, onQuotes }: Props) {
  const copy = (en: string, zh: string) => language === "zh" ? zh : en;
  const [records, setRecords] = useState<Record[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [previous, setPrevious] = useState<(string | null)[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    async function load() {
      try {
        const response = await fetch(`/api/quote-inputs?format=json${cursor ? `&before=${cursor}` : ""}`, { cache: "no-store", signal: abort.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load quote inputs.");
        if (!abort.signal.aborted) { setRecords(result.records); setNext(result.next); }
      } catch (err) {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load quote inputs.");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => abort.abort();
  }, [cursor]);

  return <div className="content workspace-page company-account">
    <header className="page-heading">
      <div><h1>{copy("Company Account", "公司账户")}</h1><p>{companyName}</p></div>
      <nav className="company-account-nav" aria-label={copy("Company account", "公司账户")}>
        <button type="button" onClick={onProfile}>{copy("Profile", "个人资料")}</button>
        <button type="button" onClick={onUsers}>{copy("Users", "用户")}</button>
        <span aria-current="page">Quote input</span>
        <button type="button" onClick={onQuotes}>{copy("Quotes", "报价")}</button>
      </nav>
    </header>
    <div className="company-user-toolbar">
      <span>{copy("Submission times use Pacific Time (PT).", "提交时间按太平洋时间（PT）显示。")}</span>
      <a href="/api/quote-inputs" download="smart-quote-history.txt" className="company-user-link">{copy("Download text file", "下载文本文件")}</a>
    </div>
    {error && <p role="alert" className="quotes-error">{error}</p>}
    {loading && <p role="status">{copy("Loading…", "加载中…")}</p>}
    {!loading && !error && <div className="quote-input-records">
      {records.length === 0 && <p className="panel">{copy("No quote inputs recorded yet.", "暂无询价原文记录。")}</p>}
      {records.map((row) => <article className="panel quote-input-record" key={row.id}>
        <header>
          <strong>#{row.id}</strong>
          <time dateTime={row.created_at}>{new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "medium" }).format(new Date(row.created_at))} PT</time>
        </header>
        <p>{row.customer_name} · {row.user_name || row.user_email}{row.user_name && ` · ${row.user_email}`}</p>
        <pre>{row.input_text}</pre>
      </article>)}
    </div>}
    <footer className="company-user-pages">
      <button type="button" disabled={loading || previous.length === 0} onClick={() => { setCursor(previous.at(-1) ?? null); setPrevious(previous.slice(0, -1)); }}>{copy("Previous", "上一页")}</button>
      <button type="button" disabled={loading || !next || Boolean(error)} onClick={() => { setPrevious([...previous, cursor]); setCursor(next); }}>{copy("Next", "下一页")}</button>
    </footer>
  </div>;
}
