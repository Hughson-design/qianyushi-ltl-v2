import "server-only";

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return { url, key };
}

export function supabaseRequest(path: string, init?: RequestInit) {
  const { url, key } = supabaseConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

export async function supabaseRpc(functionName: string, body: Record<string, unknown>) {
  return supabaseRequest(`rpc/${functionName}`, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
}

export async function responseError(response: Response, fallback: string) {
  const text = await response.text();
  try {
    const data = JSON.parse(text);
    const message = String(data.message || data.error || "");
    const allowed = ["Insufficient deposit balance", "Only a draft quote can generate a BOL", "Quote not found", "Only a booked shipment can be voided", "Adjustment would make the deposit balance negative"];
    return allowed.includes(message) ? message : fallback;
  } catch {
    return fallback;
  }
}
