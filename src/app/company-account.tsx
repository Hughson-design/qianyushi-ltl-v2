"use client";

import { FormEvent, ReactNode, useState } from "react";

type CompanyUser = { user_id: string; email: string; full_name: string; role: string; active: boolean };
type Props = {
  language: "en" | "zh";
  customerName: string;
  currentUserId: string;
  users: CompanyUser[];
  roleLabels: Record<string, string>;
  loading: boolean;
  error: string;
  createForm: ReactNode;
  onProfile: () => void;
  onQuotes: () => void;
  onQuoteInputs: () => void;
  onSave: (user: CompanyUser, requestedEmail?: string) => Promise<boolean>;
};

export function CompanyAccount({ language, customerName, currentUserId, users, roleLabels, loading, error, createForm, onProfile, onQuotes, onQuoteInputs, onSave }: Props) {
  const copy = (en: string, zh: string) => language === "zh" ? zh : en;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(0);
  const [panel, setPanel] = useState<"add" | "view" | "edit" | null>(null);
  const [selectedUser, setSelectedUser] = useState<CompanyUser | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState("");
  const canEdit = (user: CompanyUser) => user.role === "customer" || user.role === "customer_admin";
  const canChangeStatus = (user: CompanyUser) => canEdit(user) && user.user_id !== currentUserId;
  const needle = search.trim().toLowerCase();
  const filtered = users.filter((user) =>
    (status === "all" || user.active === (status === "active")) &&
    (!needle || `${user.full_name} ${user.email}`.toLowerCase().includes(needle)));
  const lastPage = Math.max(0, Math.ceil(filtered.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const pageUsers = filtered.slice(start, start + pageSize);
  const focused = users.find((user) => user.user_id === selectedUser?.user_id);

  function openUser(user: CompanyUser, mode: "view" | "edit") {
    setSelectedUser(user);
    setName(user.full_name);
    setEmail(user.email);
    setNotice("");
    setPanel(mode);
  }

  async function saveName(event: FormEvent) {
    event.preventDefault();
    if (!focused || !canEdit(focused) || !name.trim()) return;
    const nextEmail = email.trim().toLowerCase();
    const requestedEmail = nextEmail !== focused.email.toLowerCase() ? nextEmail : undefined;
    if (await onSave({ ...focused, full_name: name.trim() }, requestedEmail)) {
      setNotice(requestedEmail
        ? copy("Email change requested. The user can confirm it in My Account.", "已提交邮箱修改。请该用户在「我的账户」确认。")
        : copy("Changes saved.", "已保存修改。"));
      setPanel("view");
    }
  }

  function statusLabel(user: CompanyUser) {
    return user.active ? copy("Active", "已启用") : copy("Inactive", "已停用");
  }

  return (
    <div className="content workspace-page company-account">
      <header className="page-heading">
        <div><h1>{copy("Company Account", "公司账户")}</h1><p>{customerName}</p></div>
        <nav className="company-account-nav" aria-label={copy("Company account", "公司账户")}>
          <button type="button" onClick={onProfile}>{copy("Profile", "个人资料")}</button>
          <span aria-current="page">{copy("Users", "用户")}</span>
          <button type="button" onClick={onQuoteInputs}>Quote input</button>
          <button type="button" onClick={onQuotes}>{copy("Quotes", "报价")}</button>
        </nav>
      </header>

      <div className="company-user-toolbar">
        <label>{copy("Search", "搜索")}<input type="search" placeholder={copy("Name or email", "姓名或邮箱")} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
        <label>{copy("Status", "状态")}<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}>
          <option value="all">{copy("All users", "所有用户")}</option>
          <option value="active">{copy("Active", "已启用")}</option>
          <option value="inactive">{copy("Inactive", "已停用")}</option>
        </select></label>
        <button type="button" className="company-add-user" onClick={() => setPanel(panel === "add" ? null : "add")} aria-expanded={panel === "add"}>{copy("Add user", "添加用户")}</button>
      </div>

      {error && <p className="quotes-error" role="alert">{error}</p>}
      {notice && <p className="settings-success" role="status">{notice}</p>}
      {panel && (panel === "add" || focused) && <section className="panel company-user-panel">
        <header><h2>{panel === "add" ? copy("Add user", "添加用户") : panel === "edit" ? copy("Edit user", "编辑用户") : copy("User details", "用户详情")}</h2>
          <button type="button" onClick={() => setPanel(null)}>{copy("Close", "关闭")}</button></header>
        {panel === "add" ? createForm : focused && (panel === "edit" ? (
          <form className="customer-form" onSubmit={saveName}>
            <label>{copy("Name", "姓名")}<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>{copy("Email / Login ID", "邮箱 / 登录 ID")}<input required type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <small>{copy("The current login email remains active until the user confirms the change.", "用户确认后，新邮箱才会成为登录账号。")}</small>
            <button type="submit" disabled={loading}>{copy("Save", "保存")}</button>
          </form>
        ) : <dl>
          <dt>{copy("Name", "姓名")}</dt><dd>{focused.full_name}</dd>
          <dt>{copy("Email / Login ID", "邮箱 / 登录 ID")}</dt><dd>{focused.email}</dd>
          <dt>{copy("Role", "角色")}</dt><dd>{roleLabels[focused.role] ?? focused.role}</dd>
          <dt>{copy("Status", "状态")}</dt><dd>{statusLabel(focused)}</dd>
        </dl>)}
      </section>}

      <div className="company-users-list">
        <table aria-label={copy("Company users", "公司用户")}>
          <thead><tr>
            <th scope="col">{copy("Name", "姓名")}</th>
            <th scope="col">{copy("Email / Login ID", "邮箱 / 登录 ID")}</th>
            <th scope="col">{copy("Role", "角色")}</th>
            <th scope="col">{copy("Status", "状态")}</th>
            <th scope="col">{copy("Actions", "操作")}</th>
          </tr></thead>
          <tbody>
            {pageUsers.map((user) => <tr key={user.user_id}>
              <td><button className="company-user-link" type="button" onClick={() => openUser(user, "view")}>{user.full_name}</button></td>
              <td>{user.email}</td>
              <td>{roleLabels[user.role] ?? user.role}</td>
              <td><span className="company-user-status" data-active={user.active}>{statusLabel(user)}</span></td>
              <td><div className="company-user-actions">
                <button type="button" className="company-user-link" onClick={() => openUser(user, "view")}>{copy("View", "查看")}</button>
                {canEdit(user) && <details className="company-user-more">
                  <summary aria-label={`${copy("Actions for", "管理")} ${user.full_name}`}>⋮</summary>
                  <div>
                    {canChangeStatus(user) && <button type="button" disabled={loading} onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      void onSave({ ...user, active: !user.active });
                    }}>{user.active ? copy("Deactivate", "停用") : copy("Activate", "启用")}</button>}
                    <button type="button" onClick={(event) => {
                      event.currentTarget.closest("details")?.removeAttribute("open");
                      openUser(user, "edit");
                    }}>{copy("Edit", "编辑")}</button>
                  </div>
                </details>}
              </div></td>
            </tr>)}
            {pageUsers.length === 0 && <tr><td colSpan={5} className="company-users-empty">{loading ? copy("Loading users…", "正在加载用户…") : copy("No users match.", "没有符合条件的用户。")}</td></tr>}
          </tbody>
        </table>
      </div>

      <footer className="company-user-pages">
        <label>{copy("Display", "每页显示")}<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(0); }}>
          {[10, 25, 50].map((size) => <option key={size}>{size}</option>)}
        </select></label>
        <span>{`${filtered.length ? start + 1 : 0}–${start + pageUsers.length} ${copy("of", "／")} ${filtered.length}`}</span>
        <button type="button" aria-label={copy("Previous page", "上一页")} disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>‹</button>
        <button type="button" aria-label={copy("Next page", "下一页")} disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}>›</button>
      </footer>
    </div>
  );
}
