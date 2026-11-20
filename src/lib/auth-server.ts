import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

const ACCESS_COOKIE = "ltl_access_token";
const REFRESH_COOKIE = "ltl_refresh_token";
export const ACTIVE_CUSTOMER_COOKIE = "ltl_active_customer";

export const appRoles = ["admin", "operations", "sales", "customer_admin", "customer"] as const;
export type AppRole = typeof appRoles[number];

export function normalizeLoginEmail(value: unknown) {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  return email.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : null;
}

export type AppSession = {
  userId: string;
  customerId: string | null;
  customerName: string;
  email: string;
  name: string;
  role: AppRole;
  canSelfBook: boolean;
  legacy?: boolean;
};

function publishableKey() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("Supabase authentication is not configured.");
  return key;
}

export async function authSchemaStatus() {
  const response = await supabaseRequest("app_users?select=user_id&limit=1");
  if (!response.ok) {
    const detail = await response.text();
    if (response.status === 404 || detail.includes("app_users")) return { ready: false, hasUsers: false };
    throw new Error("Unable to check authentication setup.");
  }
  const rows = await response.json();
  return { ready: true, hasUsers: rows.length > 0 };
}

export async function supabaseAuth(path: string, init?: RequestInit, accessToken?: string) {
  const { url } = supabaseConfig();
  const key = publishableKey();
  return fetch(`${url}/auth/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken || key}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

export async function supabaseOwnUser(session: AppSession, init?: RequestInit) {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token || tokenSession(token)?.userId !== session.userId) return new Response(null, { status: 401 });
  return supabaseAuth("user", init, token);
}

function tokenSession(accessToken: string) {
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8"));
    if (!/^[0-9a-f-]{36}$/i.test(claims.sub) || !/^[0-9a-f-]{36}$/i.test(claims.session_id)) return null;
    return { userId: String(claims.sub), sessionId: String(claims.session_id) };
  } catch {
    return null;
  }
}

// Called only with tokens returned by Supabase Auth on a successful sign-in.
export async function setAuthCookies(accessToken: string, refreshToken: string, expiresIn = 3600) {
  const session = tokenSession(accessToken);
  if (!session) throw new Error("Unable to identify the new session.");
  const response = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(session.userId)}&active=eq.true`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ active_session_id: session.sessionId }),
  });
  if (!response.ok) throw new Error("Unable to activate the new session.");
  if (!(await response.json()).length) throw new Error("This login account is inactive.");
  const store = await cookies();
  store.delete(ACTIVE_CUSTOMER_COOKIE);
  const secure = process.env.NODE_ENV === "production";
  store.set(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  store.set(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  store.delete(ACTIVE_CUSTOMER_COOKIE);
}

export async function signOutSession() {
  await getAppSession();
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  const session = token ? tokenSession(token) : null;
  if (session && token) {
    // Compare-and-clear: an old browser must never clear a newer login.
    const user = await supabaseAuth("user", undefined, token);
    if (user.ok && (await user.json()).id === session.userId) {
      const cleared = await supabaseRequest(`app_users?user_id=eq.${encodeURIComponent(session.userId)}&active_session_id=eq.${encodeURIComponent(session.sessionId)}`, { method: "PATCH", body: JSON.stringify({ active_session_id: null }) });
      if (!cleared.ok) throw new Error("Unable to end the server session. Please try signing out again.");
      const revoked = await supabaseAuth("logout?scope=local", { method: "POST" }, token);
      if (!revoked.ok && ![401, 403, 404].includes(revoked.status)) throw new Error("Workspace access ended, but authentication sign-out needs a retry.");
    }
  }
  await clearAuthCookies();
}

type Refreshed = { access_token: string; refresh_token: string; user?: { id?: string } };
const refreshing = new Map<string, { expires: number; value: Promise<Refreshed | null> }>();
async function refreshSession(refreshToken: string): Promise<Refreshed | null> {
  const now = Date.now();
  for (const [key, value] of refreshing) if (value.expires <= now) refreshing.delete(key);
  const pending = refreshing.get(refreshToken);
  if (pending) return pending.value;
  const value = (async () => {
    const response = await supabaseAuth("token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) });
    return response.ok ? await response.json() as Refreshed : null;
  })();
  if (refreshing.size < 1000) refreshing.set(refreshToken, { expires: now + 10_000, value });
  return value;
}

async function profileForUser(userId: string) {
  const response = await supabaseRequest(`app_users?select=user_id,customer_id,email,full_name,role,active,active_session_id,customers(name,active,can_self_book)&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

export async function getAppSession(): Promise<AppSession | null> {
  const schema = await authSchemaStatus();
  if (!schema.ready) {
    return null;
  }
  if (!schema.hasUsers) return null;

  const store = await cookies();
  let accessToken = store.get(ACCESS_COOKIE)?.value;
  let userResponse = accessToken ? await supabaseAuth("user", undefined, accessToken) : null;
  if (!userResponse?.ok) {
    // Retry only expired/absent authentication, never upstream outages.
    if (userResponse && userResponse.status !== 401 && userResponse.status !== 403) return null;
    const refreshToken = store.get(REFRESH_COOKIE)?.value;
    if (!refreshToken) return null;
    const refreshed = await refreshSession(refreshToken);
    if (!refreshed?.access_token || !refreshed.refresh_token) return null;
    const renewed = tokenSession(refreshed.access_token);
    if (!renewed) return null;
    const profile = await profileForUser(renewed.userId);
    // Never reactivate a session displaced by another device or by sign-out.
    if (!profile?.active || profile.active_session_id !== renewed.sessionId) return null;
    accessToken = refreshed.access_token;
    userResponse = await supabaseAuth("user", undefined, accessToken);
    if (!userResponse.ok) return null;
    const secure = process.env.NODE_ENV === "production";
    store.set(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    store.set(REFRESH_COOKIE, refreshed.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  if (!accessToken) return null;
  const authUser = await userResponse.json();
  const profile = await profileForUser(String(authUser.id || ""));
  const homeCustomer = Array.isArray(profile?.customers) ? profile.customers[0] : profile?.customers;
  const token = tokenSession(accessToken);
  if (!token || token.userId !== authUser.id || profile?.active_session_id !== token.sessionId) return null;
  if (!profile?.active || !profile.customer_id || homeCustomer?.active !== true) return null;
  let activeCustomer = homeCustomer;
  let customerId = profile.customer_id || null;
  if (profile.role === "admin") {
    const selectedId = store.get(ACTIVE_CUSTOMER_COOKIE)?.value;
    if (selectedId && /^[0-9a-f-]{36}$/i.test(selectedId)) {
      const selectedResponse = await supabaseRequest(`customers?select=id,name,active,can_self_book&id=eq.${encodeURIComponent(selectedId)}&limit=1`);
      const selected = selectedResponse.ok ? (await selectedResponse.json())[0] : null;
      if (selected?.active) {
        activeCustomer = selected;
        customerId = selected.id;
      }
    }
  }
  return {
    userId: profile.user_id,
    customerId,
    customerName: activeCustomer?.name || "Customer",
    email: profile.email || authUser.email || "",
    name: profile.full_name || profile.email || "User",
    role: profile.role,
    canSelfBook: !["customer", "customer_admin"].includes(profile.role) || activeCustomer?.can_self_book !== false,
  };
}

export async function requireAppSession() {
  const session = await getAppSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Please sign in to continue." }, { status: 401 }) };
  return { session, response: null };
}

export async function requireAdminSession() {
  const result = await requireAppSession();
  if (!result.session || result.response) return result;
  if (result.session.role !== "admin") {
    return { session: null, response: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) };
  }
  return result;
}

export async function requireUserManagerSession() {
  const result = await requireAppSession();
  if (!result.session || result.response) return result;
  const { role, customerId } = result.session;
  if (role !== "admin" && (role !== "customer_admin" || !customerId)) {
    return { session: null, response: NextResponse.json({ error: "User management access is required." }, { status: 403 }) };
  }
  return result;
}

export function customerFilter(session: AppSession) {
  return session.customerId ? `&customer_id=eq.${encodeURIComponent(session.customerId)}` : "";
}

export async function authResponseError(response: Response, fallback: string) {
  const detail = await response.json().catch(() => ({}));
  return detail.code === "invalid_credentials" || String(detail.msg || detail.message || "").toLowerCase().includes("invalid login") ? "Incorrect email or password." : fallback;
}
