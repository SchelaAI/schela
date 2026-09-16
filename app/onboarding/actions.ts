"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordOperationalEvent } from "@/lib/observability/events";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function completeOnboarding(formData: FormData) {
  const { user } = await requireUser();
  const limit = await consumeRateLimit({ scope: "onboarding", identifier: user.id, limit: 10, windowSeconds: 3600 });
  if (!limit.allowed) redirect("/onboarding?error=Too%20many%20attempts.%20Please%20try%20again%20later.");

  const fullName = value(formData, "fullName");
  const company = value(formData, "company");
  const role = value(formData, "role");
  const teamSize = value(formData, "teamSize");
  const channelPreference = value(formData, "channelPreference");

  if (
    !fullName || fullName.length > 120 ||
    !company || company.length > 160 ||
    !role || role.length > 100 ||
    !teamSize || teamSize.length > 50 ||
    !["wa", "em", "both"].includes(channelPreference)
  ) {
    redirect("/onboarding?error=Please%20complete%20every%20onboarding%20field");
  }

  const admin = createAdminClient();
  const { data: existingProfile, error: profileReadError } = await admin
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();

  if (profileReadError && profileReadError.code !== "PGRST116") {
    await recordOperationalEvent({ severity: "error", source: "onboarding", eventType: "profile_read_failed", message: profileReadError.message });
    redirect("/onboarding?error=Could%20not%20load%20your%20profile.%20Please%20try%20again.");
  }

  if (!existingProfile) {
    const { error: profileCreateError } = await admin.from("profiles").upsert({
      id: user.id,
      email: user.email ?? "",
      full_name: fullName.slice(0, 120),
    });
    if (profileCreateError) {
      await recordOperationalEvent({ severity: "error", source: "onboarding", eventType: "profile_create_failed", message: profileCreateError.message });
      redirect("/onboarding?error=Could%20not%20prepare%20your%20profile.%20Please%20try%20again.");
    }
  }

  let orgId = (existingProfile?.org_id as string | null) ?? null;
  if (!orgId) {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .insert({ name: company.slice(0, 160) })
      .select("id")
      .single();
    if (orgError || !org) {
      await recordOperationalEvent({ severity: "error", source: "onboarding", eventType: "organization_create_failed", message: orgError?.message || "Missing organization row" });
      redirect("/onboarding?error=Could%20not%20create%20the%20company%20workspace.%20Please%20try%20again.");
    }
    orgId = org.id as string;
  } else {
    await admin.from("organizations").update({ name: company.slice(0, 160) }).eq("id", orgId);
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({
      org_id: orgId,
      full_name: fullName.slice(0, 120),
      company: company.slice(0, 160),
      onboarding_role: role.slice(0, 100),
      team_size: teamSize.slice(0, 50),
      channel_preference: channelPreference,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    await recordOperationalEvent({ severity: "error", source: "onboarding", eventType: "profile_update_failed", orgId, message: updateError.message });
    redirect("/onboarding?error=Could%20not%20finish%20onboarding.%20Please%20try%20again.");
  }

  await admin.from("integrations").upsert(
    [
      { id: "whatsapp", org_id: orgId, name: "WhatsApp", icon: "chat", connected: false },
      { id: "resend", org_id: orgId, name: "Resend Email", icon: "mail", connected: false },
      { id: "calendly", org_id: orgId, name: "Calendly", icon: "calendar", connected: false },
    ],
    { onConflict: "id,org_id" },
  );

  redirect("/settings/company?welcome=1");
}
