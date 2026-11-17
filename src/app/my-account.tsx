"use client";

import { FormEvent, useEffect, useState } from "react";

type Profile = { firstName: string; lastName: string; phone: string };
type ShippingAddress = {
  id: string; company: string; address1: string; address2: string;
  city: string; state: string; zip: string; country: string; phone: string;
};
type AccountData = {
  profile: Profile; addresses: ShippingAddress[]; defaultAddress: ShippingAddress | null; addressesAvailable: boolean;
};
type AccountProps = {
  language: "en" | "zh";
  user: { email: string; role: string; customerName: string; customerId: string | null };
  onBack: () => void;
  onAddressBook: () => void;
  onQuotes: () => void;
};

const roleNames: Record<string, [string, string]> = {
  admin: ["Administrator", "总管理员"],
  customer_admin: ["Customer administrator", "客户管理员"],
  customer: ["Customer", "普通用户"],
  operations: ["Operations", "运营"],
  sales: ["Sales", "销售"],
};

export function MyAccount({ language, user, onBack, onAddressBook, onQuotes }: AccountProps) {
  const copy = (en: string, zh: string) => language === "zh" ? zh : en;
  const [data, setData] = useState<AccountData | null>(null);
  const [edit, setEdit] = useState<"profile" | "password" | "shipping" | null>(null);
  const [profile, setProfile] = useState<Profile>({ firstName: "", lastName: "", phone: "" });
  const [addressId, setAddressId] = useState("");
  const [passwords, setPasswords] = useState({ currentPassword: "", password: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const customerId = user.customerId;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/account", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to load My Account.");
        if (!controller.signal.aborted) {
          setData(result);
          setProfile(result.profile);
          setAddressId(result.defaultAddress?.id || "");
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load My Account.");
      }
    }
    void load();
    return () => controller.abort();
  }, [customerId]);

  function openEditor(section: typeof edit) {
    if (saving) return;
    if (data) {
      setProfile(data.profile);
      setAddressId(data.defaultAddress?.id || "");
    }
    setPasswords({ currentPassword: "", password: "" });
    setError("");
    setNotice("");
    setEdit(section);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!data || !edit || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    const cleanProfile = { firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), phone: profile.phone.trim() };
    const payload = edit === "profile" ? cleanProfile : edit === "password" ? passwords : { addressId: addressId || null, customerId };
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: edit, ...payload }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || copy("Unable to save changes.", "无法保存修改。"));
      if (edit === "profile") setData({ ...data, profile: cleanProfile });
      if (edit === "shipping") setData({ ...data, defaultAddress: data.addresses.find((address) => address.id === addressId) ?? null });
      setPasswords({ currentPassword: "", password: "" });
      setEdit(null);
      setNotice(copy("Changes saved.", "已保存修改。"));
    } catch (err) {
      setError(err instanceof Error ? err.message : copy("Unable to save changes.", "无法保存修改。"));
    } finally {
      setSaving(false);
    }
  }

  const actions = (
    <div className="account-actions">
      <button type="submit" disabled={saving}>{saving ? copy("Saving…", "保存中…") : copy("Save", "保存")}</button>
      <button type="button" disabled={saving} onClick={() => openEditor(null)}>{copy("Cancel", "取消")}</button>
    </div>
  );
  const address = data?.defaultAddress;
  const role = roleNames[user.role]?.[language === "zh" ? 1 : 0] ?? user.role;

  return (
    <div className="content workspace-page account-page">
      <header className="page-heading">
        <div><h1>{copy("My Account", "我的账户")}</h1></div>
        <div className="account-links">
          <button type="button" onClick={onBack}>← {copy("Back", "返回")}</button>
          <button type="button" onClick={onQuotes}>{copy("Quotes", "报价")}</button>
        </div>
      </header>
      {error && <p className="quotes-error" role="alert">{error}</p>}
      {notice && <p className="settings-success" role="status">{notice}</p>}
      {!data && !error && <p role="status">{copy("Loading your account…", "正在加载账户…")}</p>}
      <div className="account-grid">
        <div className="account-column">
          <section className="panel account-card">
            <header><h2>{copy("Account information", "账户信息")}</h2>
              <button type="button" disabled={!data || saving} onClick={() => openEditor("profile")}>{copy("Edit profile", "编辑资料")}</button>
            </header>
            <dl>
              <dt>{copy("Username", "用户名")}</dt><dd>{user.email}</dd>
              <dt>{copy("Password", "密码")}</dt><dd><span aria-hidden="true">••••••••</span> <button type="button" disabled={!data || saving} onClick={() => openEditor("password")}>{copy("Change password", "修改密码")}</button></dd>
              {edit !== "profile" && <>
                <dt>{copy("First name", "名")}</dt><dd>{data?.profile.firstName || "—"}</dd>
                <dt>{copy("Last name", "姓")}</dt><dd>{data?.profile.lastName || "—"}</dd>
                <dt>{copy("Primary phone number", "主要联系电话")}</dt><dd>{data?.profile.phone || "—"}</dd>
              </>}
            </dl>
            {edit === "profile" && <form onSubmit={save} className="account-form">
              <label>{copy("First name", "名")}<input required maxLength={80} autoComplete="given-name" value={profile.firstName} onChange={(e) => setProfile({ ...profile, firstName: e.target.value })} /></label>
              <label>{copy("Last name", "姓")}<input maxLength={80} autoComplete="family-name" value={profile.lastName} onChange={(e) => setProfile({ ...profile, lastName: e.target.value })} /></label>
              <label>{copy("Primary phone number", "主要联系电话")}<input type="tel" maxLength={40} autoComplete="tel" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
              {actions}
            </form>}
            {edit === "password" && <form onSubmit={save} className="account-form">
              <label>{copy("Current password", "当前密码")}<input required type="password" autoComplete="current-password" value={passwords.currentPassword} onChange={(e) => setPasswords({ ...passwords, currentPassword: e.target.value })} /></label>
              <label>{copy("New password", "新密码")}<input required minLength={8} maxLength={72} type="password" autoComplete="new-password" value={passwords.password} onChange={(e) => setPasswords({ ...passwords, password: e.target.value })} /></label>
              {actions}
            </form>}
          </section>
          <section className="panel account-card"><header><h2>{copy("Roles", "角色")}</h2></header><span className="user-role-badge" data-role={user.role}>{role}</span></section>
        </div>
        <div className="account-column">
          <section className="panel account-card">
            <header><h2>{copy("Company info", "公司信息")}</h2></header>
            <dl><dt>{copy("Company", "公司")}</dt><dd>{user.customerName || "—"}</dd></dl>
          </section>
          <section className="panel account-card">
            <header><h2>{copy("Default shipping address", "默认发货地址")}</h2>
              <button type="button" disabled={!data?.addressesAvailable || saving} onClick={() => openEditor("shipping")}>{copy("Edit", "编辑")}</button>
            </header>
            {address ? <address>
              <strong>{address.company}</strong><br />
              {address.address1}{address.address2 && <><br />{address.address2}</>}<br />
              {address.city}, {address.state} {address.zip}<br />
              {address.country}
              {address.phone && <><br />{address.phone}</>}
            </address> : <p>{data && !data.addressesAvailable ? copy("Unable to load saved addresses.", "无法加载地址簿。") : copy("No default shipping address selected.", "尚未选择默认发货地址。")}</p>}
            {edit === "shipping" && <form onSubmit={save} className="account-form">
              <label>{copy("Saved shipping address", "已保存的发货地址")}
                <select value={addressId} onChange={(e) => setAddressId(e.target.value)}>
                  <option value="">{copy("No default", "无默认地址")}</option>
                  {data?.addresses.map((item) => <option value={item.id} key={item.id}>{item.company} · {item.address1}, {item.city} {item.zip}</option>)}
                </select>
              </label>
              {actions}
            </form>}
            <button type="button" className="account-book-link" onClick={onAddressBook}>{copy("Open address book", "打开地址簿")}</button>
          </section>
        </div>
      </div>
    </div>
  );
}
