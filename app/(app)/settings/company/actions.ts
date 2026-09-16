"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordOperationalEvent } from "@/lib/observability/events";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function updateCompany(formData: FormData) {
  const { profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const name = value(formData, "name");
  const websiteRaw = value(formData, "website");
  if (!name || name.length > 160) redirect("/settings/company?error=Company%20name%20is%20required");

  let website: string | null = null;
  if (websiteRaw) {
    try {
      const parsed = new URL(websiteRaw.startsWith("http") ? websiteRaw : `https://${websiteRaw}`);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
      website = parsed.toString().slice(0, 500);
    } catch {
      redirect("/settings/company?error=Enter%20a%20valid%20company%20website");
    }
  }

  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ name: name.slice(0, 160), website, updated_at: new Date().toISOString() }).eq("id", orgId);
  if (error) {
    await recordOperationalEvent({ severity: "error", source: "company", eventType: "company_update_failed", orgId, message: error.message });
    redirect("/settings/company?error=Could%20not%20update%20the%20company.%20Please%20try%20again.");
  }
  revalidatePath("/settings/company");
  revalidatePath("/dashboard");
}

export async function addInterviewer(formData: FormData) {
  const { profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const limit = await consumeRateLimit({ scope: "interviewer_create", identifier: orgId, limit: 50, windowSeconds: 3600 });
  if (!limit.allowed) redirect("/settings/company?error=Too%20many%20changes.%20Please%20try%20again%20later.");

  const name = value(formData, "name");
  const role = value(formData, "role").slice(0, 160) || null;
  const emailRaw = value(formData, "email").toLowerCase();
  const email = emailRaw || null;
  if (!name || name.length > 160 || (email && !/^\S+@\S+\.\S+$/.test(email))) {
    redirect("/settings/company?error=Enter%20a%20valid%20interviewer%20name%20and%20email");
  }

  const admin = createAdminClient();
  const { error } = await admin.from("interviewers").insert({ org_id: orgId, name: name.slice(0, 160), role, email });
  if (error) {
    await recordOperationalEvent({ severity: "error", source: "company", eventType: "interviewer_create_failed", orgId, message: error.message });
    redirect("/settings/company?error=Could%20not%20add%20the%20interviewer.%20Please%20try%20again.");
  }
  revalidatePath("/settings/company");
  revalidatePath("/interviews/new");
}

export async function removeInterviewer(formData: FormData) {
  const { profile } = await requireAppUser();
  const id = value(formData, "id");
  if (!id) return;
  const admin = createAdminClient();
  await admin.from("interviewers").delete().eq("id", id).eq("org_id", profile.org_id!);
  revalidatePath("/settings/company");
}
