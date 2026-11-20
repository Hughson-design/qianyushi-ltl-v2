import { NextResponse } from "next/server";

import { responseError, supabaseRequest } from "@/lib/supabase-server";
import { requireAdminSession, requireAppSession } from "@/lib/auth-server";

export const runtime = "nodejs";

const defaults = {
  company_name: "Shenzhen Qianyushi Supply Chain Service Co.,Ltd.",
  contact_name: "Cathy Huang",
  email: "",
  phone: "",
  default_ready_time: "09:00",
  default_close_time: "16:00",
  markup_percent: 0,
  minimum_markup: 0,
  wwex_enabled: true,
  priority1_enabled: true,
  tql_enabled: false,
  mothership_enabled: true,
};

async function settingsStorageError(response: Response, fallback: string) {
  const detail = await responseError(response, fallback);
  const missing = response.status === 404 || detail.includes("platform_settings");
  return NextResponse.json(
    { error: missing ? "Settings storage is not ready. Run the provided Supabase SQL first." : detail },
    { status: missing ? 503 : 502 },
  );
}

export async function GET() {
  try {
    const auth = await requireAppSession();
    if (auth.response || !auth.session) return auth.response;
    const response = await supabaseRequest("platform_settings?select=*&id=eq.true&limit=1");
    if (!response.ok) return settingsStorageError(response, "Unable to load settings.");
    const rows = await response.json();
    const settings = { ...defaults, ...(rows[0] || {}) };
    if (auth.session.role !== "admin") {
      return NextResponse.json({ settings: Object.fromEntries(["company_name", "contact_name", "email", "phone", "default_ready_time", "default_close_time"].map(key => [key, settings[key]])) }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ settings }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load settings." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAdminSession();
    if (auth.response || !auth.session) return auth.response;
    const body = await request.json();
    const record = {
      id: true,
      company_name: String(body.company_name || "").trim(),
      contact_name: String(body.contact_name || "").trim(),
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim(),
      default_ready_time: String(body.default_ready_time || "09:00"),
      default_close_time: String(body.default_close_time || "16:00"),
      markup_percent: Math.max(0, Number(body.markup_percent) || 0),
      minimum_markup: Math.max(0, Number(body.minimum_markup) || 0),
      wwex_enabled: body.wwex_enabled !== false,
      priority1_enabled: body.priority1_enabled !== false,
      tql_enabled: body.tql_enabled === true,
      ...(typeof body.mothership_enabled === "boolean" ? { mothership_enabled: body.mothership_enabled } : {}),
      updated_at: new Date().toISOString(),
    };
    if (!record.company_name) return NextResponse.json({ error: "Company name is required." }, { status: 400 });
    if (record.default_close_time <= record.default_ready_time) return NextResponse.json({ error: "Default close time must be later than ready time." }, { status: 400 });
    if (!record.wwex_enabled && !record.priority1_enabled && !record.tql_enabled && record.mothership_enabled !== true) return NextResponse.json({ error: "Keep at least one rate provider enabled." }, { status: 400 });
    const save = (settings: object) => supabaseRequest("platform_settings?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(settings),
    });
    let response = await save(record);
    if (!response.ok) {
      const error = await response.clone().json().catch(() => null);
      if (error?.code === "PGRST204" && String(error.message).includes("mothership_enabled")) {
        return NextResponse.json({ error: "Run the Mothership settings migration in Supabase, then save again." }, { status: 503 });
      }
      if (error?.code === "PGRST204" && String(error.message).includes("tql_enabled")) {
        if (record.tql_enabled) return NextResponse.json({ error: "Run the TQL settings migration before enabling TQL." }, { status: 503 });
        const { tql_enabled: _tql, ...legacyRecord } = record;
        response = await save(legacyRecord);
      }
    }
    if (!response.ok) return settingsStorageError(response, "Unable to save settings.");
    const rows = await response.json();
    return NextResponse.json({ settings: rows[0] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save settings." }, { status: 500 });
  }
}
