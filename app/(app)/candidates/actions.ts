"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordOperationalEvent } from "@/lib/observability/events";

function value(formData: FormData, key: string) { return String(formData.get(key) ?? "").trim(); }

export async function addCandidate(formData: FormData) {
  const { profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const limit = await consumeRateLimit({ scope: "candidate_create", identifier: orgId, limit: 100, windowSeconds: 3600 });
  if (!limit.allowed) redirect("/candidates?error=Too%20many%20candidate%20changes.%20Please%20try%20again%20later.");

  const name = value(formData, "name");
  const email = value(formData, "email").toLowerCase();
  const countryCodeRaw = value(formData, "countryCode");
  const phoneRaw = value(formData, "phone");
  const countryDigits = countryCodeRaw.replace(/\D/g, "");
  const phone = phoneRaw.replace(/\D/g, "");
  const countryCode = countryDigits ? `+${countryDigits}` : "";
  const phoneE164 = `${countryDigits}${phone}`;
  const timeZone = value(formData, "timeZone").slice(0, 100) || null;
  const notes = value(formData, "notes").slice(0, 4000) || null;

  if (!name || name.length > 160 || !/^\S+@\S+\.\S+$/.test(email) || !countryCode || phone.length < 6 || phoneE164.length > 15) {
    redirect("/candidates?error=Enter%20a%20valid%20name,%20email,%20country%20code,%20and%20phone%20number");
  }

  const id = `C-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
  const admin = createAdminClient();
  const { error } = await admin.from("candidates").insert({
    id,
    org_id: orgId,
    name: name.slice(0, 160),
    email,
    country_code: countryCode,
    phone,
    phone_e164: phoneE164,
    time_zone: timeZone,
    notes,
    ai_state: "sending_invitation",
  });
  if (error) {
    await recordOperationalEvent({ severity: "error", source: "candidates", eventType: "candidate_create_failed", orgId, message: error.message });
    redirect("/candidates?error=Could%20not%20add%20the%20candidate.%20Please%20try%20again.");
  }
  revalidatePath("/candidates");
  revalidatePath("/dashboard");
  revalidatePath("/interviews/new");
}
