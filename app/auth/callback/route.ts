import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noStoreHeaders } from "@/lib/http/security";

function redirectWithNoStore(url: string) {
  return NextResponse.redirect(url, { headers: noStoreHeaders() });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;

  if (!code) {
    return redirectWithNoStore(
      `${origin}/login?error=${encodeURIComponent("Could not complete sign in. Please try again.")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectWithNoStore(
      `${origin}/login?error=${encodeURIComponent("Could not complete sign in. Please try again.")}`,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWithNoStore(
      `${origin}/login?error=${encodeURIComponent("Could not create your Schela session. Please try again.")}`,
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("org_id,onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.org_id && profile.onboarding_completed) {
    return redirectWithNoStore(`${origin}/dashboard`);
  }

  return redirectWithNoStore(`${origin}/onboarding`);
}
