"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type Workspace = {
  id: string; name: string; code: string; active: boolean; is_internal: boolean;
  can_self_book: boolean; markup_percent: number; minimum_markup: number;
  app_users: { user_id: string; email: string; full_name: string; role: string; active: boolean }[];
};
type Props = {
  customers: Workspace[]; currentId: string | null; language: "en" | "zh"; loading: boolean;
  onSelect: (customer: Workspace) => Promise<void>;
  onSave: (customer: Workspace) => Promise<boolean>;
  onDelete: (customer: Workspace) => Promise<void>;
};

export function CustomerWorkspaces({ customers, currentId, language, loading, onSelect, onSave, onDelete }: Props) {
  const copy = (en: string, zh: string) => language === "zh" ? zh : en;
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Workspace | null>(null);
  const editor = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (draft) editor.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [draft?.id]);
  const needle = search.trim().toLowerCase();
  const visible = customers.filter((customer) => `${customer.name} ${customer.code}`.toLowerCase().includes(needle));

  async function save(event: FormEvent) {
    event.preventDefault();
    if (draft && await onSave(draft)) setDraft(null);
  }

  return <section className="panel customer-directory workspace-directory">
    <header className="workspace-directory-heading">
      <h2>{copy("Customer workspaces", "客户工作区")}</h2>
      <input type="search" aria-label={copy("Search customers", "搜索客户")} placeholder={copy("Search name or code", "搜索名称或代码")} value={search} onChange={(event) => setSearch(event.target.value)} />
    </header>
    {draft && <form ref={editor} className="workspace-editor customer-form" onSubmit={save}>
      <header><h3>{copy("Edit customer", "编辑客户")}</h3><button type="button" disabled={loading} onClick={() => setDraft(null)}>{copy("Cancel", "取消")}</button></header>
      <label>{copy("Company name", "公司名称")}<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="settings-two">
        <label>{copy("Markup (%)", "加价（%）")}<input type="number" required min="0" step="0.01" value={draft.markup_percent} onChange={(event) => setDraft({ ...draft, markup_percent: Number(event.target.value) })} /></label>
        <label>{copy("Minimum markup ($)", "最低加价（美元）")}<input type="number" required min="0" step="0.01" value={draft.minimum_markup} onChange={(event) => setDraft({ ...draft, minimum_markup: Number(event.target.value) })} /></label>
      </div>
      <div className="workspace-editor-checks">
        <label><input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /> {copy("Active", "启用")}</label>
        <label><input type="checkbox" checked={draft.can_self_book} onChange={(event) => setDraft({ ...draft, can_self_book: event.target.checked })} /> {copy("May generate BOL", "允许生成 BOL")}</label>
      </div>
      <button type="submit" disabled={loading}>{copy("Save customer", "保存客户")}</button>
    </form>}
    <div className="workspace-card-grid">
      {visible.map((customer) => <article className={`workspace-summary${customer.id === currentId ? " selected" : ""}`} key={customer.id}>
        <header>
          <div><h3>{customer.name}</h3><p>{customer.code}{customer.is_internal && ` · ${copy("Internal", "内部")}`}</p></div>
          <span className="company-user-status" data-active={customer.active}>{customer.active ? copy("Active", "已启用") : copy("Inactive", "已停用")}</span>
        </header>
        <dl>
          <div><dt>{copy("Markup", "加价")}</dt><dd>{customer.markup_percent}%</dd></div>
          <div><dt>{copy("Minimum", "最低加价")}</dt><dd>${Number(customer.minimum_markup).toFixed(2)}</dd></div>
          <div><dt>{copy("Users", "用户")}</dt><dd>{customer.app_users?.length ?? 0}</dd></div>
        </dl>
        <footer>
          <span>{customer.can_self_book ? copy("BOL enabled", "可生成 BOL") : copy("BOL disabled", "BOL 已禁用")}</span>
          <div className="workspace-card-actions">
            {customer.id === currentId
              ? <span className="workspace-current">{copy("Current workspace", "当前工作区")}</span>
              : <button type="button" disabled={loading || !customer.active} onClick={() => void onSelect(customer)}>{copy("Use workspace", "进入工作区")}</button>}
            <details className="company-user-more">
              <summary aria-label={`${copy("Manage", "管理")} ${customer.name}`}>⋮</summary>
              <div>
                <button type="button" disabled={loading} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setDraft({ ...customer }); }}>{copy("Edit", "编辑")}</button>
                {!customer.is_internal && <button type="button" disabled={loading} onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); void onDelete(customer); }}>{copy("Delete", "删除")}</button>}
              </div>
            </details>
          </div>
        </footer>
      </article>)}
    </div>
    {!visible.length && <p className="quotes-empty">{loading ? copy("Loading…", "加载中…") : copy("No matching customers.", "没有符合条件的客户。")}</p>}
  </section>;
}
