"use client";

import { FormEvent, useEffect, useRef, useState } from "react";

type User = { email: string; firstName: string; lastName: string; phone: string; customer_id: string; role: string; active: boolean };
type Props = {
  id: string; language: "en" | "zh"; customers: { id: string; name: string }[];
  onClose: () => void; onSaved: () => Promise<void>;
};

export function AdminUserEditor({ id, language, customers, onClose, onSaved }: Props) {
  const copy = (en: string, zh: string) => language === "zh" ? zh : en;
  const [user, setUser] = useState<User | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/users/${id}`, { signal: abort.signal, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load user.");
        if (!abort.signal.aborted) setUser(data.user);
      } catch (err) {
        if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load user.");
      }
    }
    void load();
    return () => abort.abort();
  }, [id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!user || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: [user.firstName.trim(), user.lastName.trim()].filter(Boolean).join(" "),
          firstName: user.firstName, lastName: user.lastName, phone: user.phone,
          email: user.email, customerId: user.customer_id, role: user.role, active: user.active,
          ...(password ? { password } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save user.");
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save user.");
    } finally {
      setSaving(false);
    }
  }

  return <dialog ref={dialog} className="admin-user-dialog" aria-labelledby="admin-user-editor-title" onCancel={(event) => {
    event.preventDefault();
    if (!saving) onClose();
  }}>
    <section className="panel company-user-panel">
    <header><h2 id="admin-user-editor-title">{copy("Edit user", "编辑用户")}</h2><button type="button" disabled={saving} onClick={onClose}>{copy("Close", "关闭")}</button></header>
    {error && <p className="quotes-error" role="alert">{error}</p>}
    {!user && !error && <p role="status">{copy("Loading…", "加载中…")}</p>}
    {user && <form className="customer-form" onSubmit={save}>
      <label>{copy("First name", "名")}<input required maxLength={80} value={user.firstName} onChange={(e) => setUser({ ...user, firstName: e.target.value })} /></label>
      <label>{copy("Last name", "姓")}<input maxLength={80} value={user.lastName} onChange={(e) => setUser({ ...user, lastName: e.target.value })} /></label>
      <label>{copy("Email / Login ID", "邮箱 / 登录 ID")}<input required type="email" maxLength={254} value={user.email} onChange={(e) => setUser({ ...user, email: e.target.value })} /></label>
      <small>{copy("Saving applies the login email immediately. Confirm that the address belongs to this user.", "保存后登录邮箱立即生效，请确认邮箱属于此用户。")}</small>
      <label>{copy("Phone", "电话")}<input type="tel" maxLength={40} value={user.phone} onChange={(e) => setUser({ ...user, phone: e.target.value })} /></label>
      <label>{copy("Customer", "所属客户")}<select required value={user.customer_id} onChange={(e) => setUser({ ...user, customer_id: e.target.value })}>
        {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
      </select></label>
      <small>{copy("Changing the customer gives this user access to that customer's workspace.", "修改所属客户后，此用户将进入新客户的工作区。")}</small>
      <label>{copy("Role", "角色")}<select value={user.role} onChange={(e) => setUser({ ...user, role: e.target.value })}>
        <option value="admin">{copy("Administrator", "总管理员")}</option>
        <option value="customer_admin">{copy("Customer administrator", "客户管理员")}</option>
        <option value="customer">{copy("Customer", "普通用户")}</option>
        <option value="operations">{copy("Operations", "运营")}</option>
        <option value="sales">{copy("Sales", "销售")}</option>
      </select></label>
      <label><span><input type="checkbox" checked={user.active} onChange={(e) => setUser({ ...user, active: e.target.checked })} /> {copy("Active", "启用")}</span></label>
      <label>{copy("New password (optional)", "新密码（选填）")}<input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <button type="submit" disabled={saving}>{saving ? copy("Saving…", "保存中…") : copy("Save user", "保存用户")}</button>
    </form>}
    </section>
  </dialog>;
}
