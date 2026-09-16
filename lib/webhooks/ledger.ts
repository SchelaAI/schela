import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export async function claimWebhookEvent(input: {
  provider: "whatsapp" | "resend" | "calendly";
  eventId: string;
  eventType?: string | null;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("webhook_events").insert({
    provider: input.provider,
    event_id: input.eventId,
    event_type: input.eventType ?? null,
    // Dedupe does not need a raw provider payload. Avoid duplicating candidate
    // PII in an internal diagnostics table.
    payload: null,
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Could not claim ${input.provider} webhook event: ${error.message}`);
}

export async function releaseWebhookEvent(provider: "whatsapp" | "resend" | "calendly", eventId: string) {
  const admin = createAdminClient();
  await admin.from("webhook_events").delete().eq("provider", provider).eq("event_id", eventId);
}
