import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { responseError, supabaseConfig, supabaseRequest } from "@/lib/supabase-server";

const ACCESS_COOKIE = "ltl_access_token";
const REFRESH_COOKIE = "ltl_refresh_token";
export const ACTIVE_CUSTOMER_COOKIE = "ltl_active_customer";

export type AppRole = "admin" | "operations" | "sales" | "customer";

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

// Recognize a missing auth table for setup status.
function isSchemaMissingTableError(status: number, detail: string) {
  if (status === 404) return true;
  try {
    const data = JSON.parse(detail);
    const code = typeof data?.code === "string" ? data.code : "";
    return code === "PGRST205" || code === "42P01";
  } catch {
    return false;
  }
}

export async function authSchemaStatus() {
  const response = await supabaseRequest("app_users?select=user_id&limit=1");
  if (!response.ok) {
    const detail = await response.text();
    if (isSchemaMissingTableError(response.status, detail)) return { ready: false, hasUsers: false };
    throw new Error(detail || "Unable to check authentication setup.");
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
  store.set(ACCESS_COOKIE, accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: Math.max(60, expiresIn) });
  store.set(REFRESH_COOKIE, refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function clearAuthCookies() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
  store.delete(ACTIVE_CUSTOMER_COOKIE);
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
  const accessToken = store.get(ACCESS_COOKIE)?.value;
  if (!accessToken) return null;
  const userResponse = await supabaseAuth("user", undefined, accessToken);
  if (!userResponse.ok) return null;
  const authUser = await userResponse.json();
  const profile = await profileForUser(String(authUser.id || ""));
  const homeCustomer = Array.isArray(profile?.customers) ? profile.customers[0] : profile?.customers;
  const token = tokenSession(accessToken);
  if (!token || token.userId !== authUser.id || profile?.active_session_id !== token.sessionId) return null;
  if (!profile?.active || !profile.customer_id || homeCustomer?.active !== true) return null;
  let activeCustomer = homeCustomer;
  let customerId = profile.customer_id || null;
  if (profile.role === "admin" || profile.role === "operations") {
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
    canSelfBook: profile.role !== "customer" || activeCustomer?.can_self_book !== false,
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
  if (result.session.role !== "admin" && result.session.role !== "operations") {
    return { session: null, response: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) };
  }
  return result;
}

export function customerFilter(session: AppSession) {
  return session.customerId ? `&customer_id=eq.${encodeURIComponent(session.customerId)}` : "";
}

export async function authResponseError(response: Response, fallback: string) {
  const detail = await responseError(response, fallback);
  return detail.toLowerCase().includes("invalid login") ? "Incorrect email or password." : detail;
}
