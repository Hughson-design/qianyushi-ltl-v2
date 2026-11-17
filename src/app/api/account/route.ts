import { NextResponse } from "next/server";
import { customerFilter, normalizeLoginEmail, requireAppSession, supabaseOwnUser } from "@/lib/auth-server";
import { supabaseRequest } from "@/lib/supabase-server";

type Profile = { firstName: string; lastName: string; phone: string };
const addressFields = "id,company,address1,address2,city,state,zip,country,phone";

function emailPreference(userId: string) {
  return supabaseRequest(`app_users?select=requested_email&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
}

export async function GET() {
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  const { session } = auth;
  if (!session.customerId) return NextResponse.json({ error: "Select a customer workspace first." }, { status: 403 });
  const [userResponse, addressResponse, emailResponse] = await Promise.all([
    supabaseOwnUser(session),
    supabaseRequest(`address_book?select=${addressFields}${customerFilter(session)}&or=(category.is.null,category.in.(sender,both))&order=company.asc&limit=200`),
    emailPreference(session.userId),
  ]);
  if (!userResponse.ok) return NextResponse.json({ error: "Unable to load your profile." }, { status: 502 });
  const user = await userResponse.json();
  const [firstName, ...lastName] = session.name.split(/\s+/);
  const stored = user.user_metadata?.ltl_profile as Partial<Profile> | undefined;
  const defaultAddressId = user.user_metadata?.[`ltl_shipping_${session.customerId}`];
  const addresses = addressResponse.ok ? await addressResponse.json() : [];
  const defaultAddress = addresses.find((address: { id: string }) => address.id === defaultAddressId) ?? null;
  return NextResponse.json({
    email: user.email || session.email,
    requestedEmail: emailResponse.ok ? (await emailResponse.json())[0]?.requested_email ?? null : null,
    emailChangeAvailable: emailResponse.ok,
    profile: {
      firstName: typeof stored?.firstName === "string" ? stored.firstName : firstName,
      lastName: typeof stored?.lastName === "string" ? stored.lastName : lastName.join(" "),
      phone: typeof stored?.phone === "string" ? stored.phone : "",
    },
    addresses,
    defaultAddress,
    addressesAvailable: addressResponse.ok,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requireAppSession();
  if (auth.response || !auth.session) return auth.response;
  const { session } = auth;
  const body = await request.json().catch(() => null);
  let update: Record<string, unknown>;
  if (body?.action === "profile") {
    const { firstName, lastName, phone } = body;
    if (typeof firstName !== "string" || !firstName.trim() || firstName.length > 80 ||
      typeof lastName !== "string" || lastName.length > 80 || typeof phone !== "string" || phone.length > 40) {
      return NextResponse.json({ error: "Enter a first name and valid profile details." }, { status: 400 });
    }
    update = { data: { ltl_profile: { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() } } };
  } else if (body?.action === "shipping") {
    if (!session.customerId || body.customerId !== session.customerId) {
      return NextResponse.json({ error: "The active customer changed. Reopen My Account." }, { status: 409 });
    }
    const { addressId } = body;
    if (addressId !== null) {
      if (typeof addressId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(addressId)) {
        return NextResponse.json({ error: "Choose a saved shipping address." }, { status: 400 });
      }
      const response = await supabaseRequest(`address_book?select=id&id=eq.${encodeURIComponent(addressId)}${customerFilter(session)}&or=(category.is.null,category.in.(sender,both))&limit=1`);
      if (!response.ok) return NextResponse.json({ error: "Unable to check the saved address." }, { status: 502 });
      if (!(await response.json())[0]) return NextResponse.json({ error: "Saved shipping address not found." }, { status: 404 });
    }
    update = { data: { [`ltl_shipping_${session.customerId}`]: addressId } };
  } else if (body?.action === "email") {
    const email = normalizeLoginEmail(body.email);
    if (!email || email === session.email.toLowerCase()) {
      return NextResponse.json({ error: "Enter a different, valid login email." }, { status: 400 });
    }
    if (!(await emailPreference(session.userId)).ok) {
      return NextResponse.json({ error: "Login email changes are not available yet." }, { status: 503 });
    }
    update = { email };
  } else if (body?.action === "password") {
    if (typeof body.currentPassword !== "string" || !body.currentPassword || body.currentPassword.length > 1024 ||
      typeof body.password !== "string" || body.password.length < 8 || body.password.length > 72) {
      return NextResponse.json({ error: "Enter your current password and a new password of 8 to 72 characters." }, { status: 400 });
    }
    update = { current_password: body.currentPassword, password: body.password };
  } else {
    return NextResponse.json({ error: "Choose an account setting to update." }, { status: 400 });
  }

  const response = await supabaseOwnUser(session, { method: "PUT", body: JSON.stringify(update) });
  if (!response.ok) {
    if (body.action === "email") {
      const detail = await response.json().catch(() => ({}));
      const messages: Record<string, string> = {
        email_address_not_authorized: "Supabase email delivery is restricted to project team members. A platform administrator must configure custom SMTP before customer verification emails can be sent.",
        over_email_send_rate_limit: "The verification email limit has been reached. Wait before retrying. A platform administrator can review Supabase email rate limits.",
        over_request_rate_limit: "Too many requests. Wait a few minutes before trying again.",
        email_address_invalid: "Supabase rejected this email address. Enter a real, deliverable address.",
        email_exists: "This email address is already registered. Choose a different login email.",
        user_already_exists: "This email address is already registered. Choose a different login email.",
        email_provider_disabled: "Email authentication is disabled in Supabase. Contact the platform administrator.",
        reauthentication_needed: "Sign in again before changing your login email.",
        session_expired: "Your session has expired. Sign in again.",
      };
      const code = typeof detail.code === "string" ? detail.code : "";
      const error = messages[code] || (response.status >= 500
        ? "Supabase could not send the verification email. A platform administrator must check Authentication logs and SMTP delivery settings."
        : "Supabase rejected the email change. A platform administrator must check Authentication logs for the reason.");
      const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 400;
      return NextResponse.json({ error, ...(messages[code] ? { code } : {}) }, { status });
    }
    const error = body.action === "password"
      ? "Unable to change the password. Check your current password and sign in again if required."
      : "Unable to save your account settings.";
    return NextResponse.json({ error }, { status: response.status >= 500 ? 502 : 400 });
  }
  return NextResponse.json({ saved: true });
}
