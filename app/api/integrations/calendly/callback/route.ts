import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeAuthorizationCode } from "@/lib/calendly/oauth";
import { createCalendlyWebhookSubscription, deleteCalendlyWebhookSubscription, getCalendlyUser } from "@/lib/calendly/client";
import { safeSecretEquals, noStoreHeaders } from "@/lib/http/security";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearOauthCookies(response: NextResponse) {
  response.cookies.set("schela_cal_state", "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.cookies.set("schela_cal_verifier", "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  response.headers.set("Cache-Control", "no-store, max-age=0");
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const oauthError = request.nextUrl.searchParams.get("error");
  const expectedState = request.cookies.get("schela_cal_state")?.value;
  const verifier = request.cookies.get("schela_cal_verifier")?.value;

  if (oauthError) {
    const response = NextResponse.redirect(new URL("/settings/integrations?error=Calendly%20authorization%20was%20not%20completed", request.url));
    clearOauthCookies(response);
    return response;
  }

  if (!code || !state || !expectedState || !safeSecretEquals(state, expectedState) || !verifier) {
    const response = NextResponse.redirect(new URL("/settings/integrations?error=Invalid%20Calendly%20OAuth%20state", request.url));
    clearOauthCookies(response);
    return response;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), { headers: noStoreHeaders() });

  const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
  if (!profile?.org_id) return NextResponse.redirect(new URL("/onboarding", request.url), { headers: noStoreHeaders() });

  const orgId = profile.org_id as string;
  const admin = createAdminClient();
  const redirectUri = `${request.nextUrl.origin}/api/integrations/calendly/callback`;

  try {
    const { data: previousConnection } = await admin
      .from("calendly_connections")
      .select("webhook_subscription_uri")
      .eq("org_id", orgId)
      .maybeSingle();

    const token = await exchangeAuthorizationCode({ code, redirectUri, codeVerifier: verifier });
    const expiresAt = new Date(Date.now() + Math.max(60, token.expires_in - 30) * 1000).toISOString();

    const { error: connectionError } = await admin.from("calendly_connections").upsert({
      org_id: orgId,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      access_token_expires_at: expiresAt,
      owner_uri: token.owner,
      organization_uri: token.organization,
      refresh_claimed_until: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "org_id" });
    if (connectionError) throw new Error(connectionError.message);

    if (previousConnection?.webhook_subscription_uri) {
      try { await deleteCalendlyWebhookSubscription(orgId, previousConnection.webhook_subscription_uri); } catch { /* stale remote subscription is non-fatal */ }
    }

    let accountName: string | null = null;
    let accountEmail: string | null = null;
    try {
      const userResource = await getCalendlyUser(orgId, token.owner);
      accountName = userResource.resource?.name ?? null;
      accountEmail = userResource.resource?.email ?? null;
    } catch { /* display metadata is non-fatal */ }

    const webhook = await createCalendlyWebhookSubscription({ orgId, callbackUrl: `${request.nextUrl.origin}/api/webhooks/calendly` });

    await Promise.all([
      admin.from("calendly_connections").update({
        account_name: accountName,
        account_email: accountEmail,
        webhook_subscription_uri: webhook.uri,
        webhook_scope: webhook.scope,
        updated_at: new Date().toISOString(),
      }).eq("org_id", orgId),
      admin.from("integrations").upsert({
        id: "calendly",
        org_id: orgId,
        name: "Calendly",
        icon: "calendar_month",
        connected: true,
        account: accountEmail || accountName || "Connected",
        last_synced: new Date().toISOString(),
        config: null,
      }, { onConflict: "id,org_id" }),
    ]);

    const response = NextResponse.redirect(new URL("/settings/integrations?connected=calendly", request.url));
    clearOauthCookies(response);
    return response;
  } catch (error) {
    await recordOperationalEvent({ severity: "error", source: "calendly_oauth", eventType: "connection_failed", orgId, message: safeErrorMessage(error, "Calendly connection failed") });
    const response = NextResponse.redirect(new URL("/settings/integrations?error=Calendly%20connection%20failed.%20Please%20try%20again.", request.url));
    clearOauthCookies(response);
    return response;
  }
}
