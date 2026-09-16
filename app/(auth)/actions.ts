"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getRequestOrigin } from "@/lib/http/origin";
import { recordOperationalEvent } from "@/lib/observability/events";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function signUp(formData: FormData) {
  const email = text(formData, "email").toLowerCase();
  const password = text(formData, "password");
  const fullName = text(formData, "fullName");

  if (!email || password.length < 8 || !fullName || fullName.length > 120) {
    redirect("/signup?error=Enter%20your%20name,%20email,%20and%20an%208%2B%20character%20password");
  }

  const limit = await consumeRateLimit({ scope: "auth_signup", identifier: email, limit: 5, windowSeconds: 3600 });
  if (!limit.allowed) {
    redirect("/signup?error=Too%20many%20signup%20attempts.%20Please%20try%20again%20later.");
  }

  const supabase = await createClient();
  const appUrl = await getRequestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName.slice(0, 120) },
      emailRedirectTo: `${appUrl}/auth/callback`,
    },
  });

  if (error) {
    await recordOperationalEvent({ severity: "warning", source: "auth", eventType: "signup_failed", message: error.message });
    redirect("/signup?error=We%20could%20not%20create%20that%20account.%20Check%20the%20details%20and%20try%20again.");
  }
  if (!data.session) {
    redirect("/login?message=Check%20your%20email%20to%20confirm%20your%20Schela%20account");
  }
  redirect("/onboarding");
}

export async function signIn(formData: FormData) {
  const email = text(formData, "email").toLowerCase();
  const password = text(formData, "password");
  if (!email || !password) redirect("/login?error=Enter%20your%20email%20and%20password");

  const limit = await consumeRateLimit({ scope: "auth_signin", identifier: email, limit: 10, windowSeconds: 600 });
  if (!limit.allowed) {
    redirect("/login?error=Too%20many%20login%20attempts.%20Please%20try%20again%20later.");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await recordOperationalEvent({ severity: "warning", source: "auth", eventType: "signin_failed", message: error.message });
    // Do not reveal whether the account or password was wrong.
    redirect("/login?error=Invalid%20email%20or%20password");
  }
  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
