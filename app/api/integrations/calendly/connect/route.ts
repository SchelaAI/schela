import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { CALENDLY_SCOPES, getCalendlyConfig } from "@/lib/calendly/config";
import { createOAuthState, createPkcePair } from "@/lib/calendly/oauth";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { noStoreHeaders } from "@/lib/http/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), { headers: noStoreHeaders() });

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id,onboarding_completed")
    .eq("id", user.id)
    .single();
  if (!profile?.org_id || !profile.onboarding_completed) {
    return NextResponse.redirect(new URL("/onboarding", request.url), { headers: noStoreHeaders() });
  }

  const limit = await consumeRateLimit({
    scope: "calendly_oauth_start",
    identifier: profile.org_id,
    limit: 10,
    windowSeconds: 600,
  });
  if (!limit.allowed) {
    return NextResponse.redirect(
      new URL("/settings/integrations?error=Too%20many%20Calendly%20connection%20attempts.%20Please%20try%20again%20later.", request.url),
      { headers: noStoreHeaders() },
    );
  }

  const { clientId } = getCalendlyConfig();
  const { verifier, challenge } = createPkcePair();
  const state = createOAuthState();
  const redirectUri = `${request.nextUrl.origin}/api/integrations/calendly/callback`;

  const authorize = new URL("https://auth.calendly.com/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", CALENDLY_SCOPES);

  const response = NextResponse.redirect(authorize, { headers: noStoreHeaders() });
  const secure = request.nextUrl.protocol === "https:";
  const cookie = { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 600 };
  response.cookies.set("schela_cal_state", state, cookie);
  response.cookies.set("schela_cal_verifier", verifier, cookie);
  return response;
}
