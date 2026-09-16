"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteCalendlyWebhookSubscription, getCalendlyConnection, listCalendlyEventTypes } from "@/lib/calendly/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordOperationalEvent } from "@/lib/observability/events";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function saveCalendlySettings(formData: FormData) {
  const { profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const limit = await consumeRateLimit({ scope: "calendly_settings", identifier: orgId, limit: 30, windowSeconds: 3600 });
  if (!limit.allowed) redirect("/settings/integrations?error=Too%20many%20changes.%20Please%20try%20again%20later.");

  const defaultUri = value(formData, "defaultEventType");
  const admin = createAdminClient();
  let eventTypes: Awaited<ReturnType<typeof listCalendlyEventTypes>>;
  try {
    eventTypes = await listCalendlyEventTypes(orgId);
  } catch (error) {
    await recordOperationalEvent({ severity: "error", source: "calendly", eventType: "event_types_load_failed", orgId, message: error instanceof Error ? error.message : "Calendly event type load failed" });
    redirect("/settings/integrations?error=Could%20not%20load%20Calendly%20event%20types.%20Please%20reconnect%20or%20try%20again.");
  }
  const byUri = new Map(eventTypes.map((eventType) => [eventType.uri, eventType]));

  if (defaultUri && !byUri.has(defaultUri)) {
    redirect("/settings/integrations?error=Selected%20Calendly%20event%20type%20is%20not%20available");
  }

  const defaultEvent = defaultUri ? byUri.get(defaultUri)! : null;
  const { error } = await admin.from("calendly_connections").update({
    default_event_type_uri: defaultEvent?.uri ?? null,
    default_event_type_name: defaultEvent?.name ?? null,
    updated_at: new Date().toISOString(),
  }).eq("org_id", orgId);
  if (error) {
    await recordOperationalEvent({ severity: "error", source: "calendly", eventType: "settings_save_failed", orgId, message: error.message });
    redirect("/settings/integrations?error=Could%20not%20save%20Calendly%20settings.%20Please%20try%20again.");
  }

  const { data: interviewers } = await admin.from("interviewers").select("id").eq("org_id", orgId);
  for (const interviewer of interviewers ?? []) {
    const uri = value(formData, `interviewer_${interviewer.id}`);
    const event = uri ? byUri.get(uri) : null;
    if (uri && !event) continue;
    await admin.from("interviewers").update({
      calendly_event_type_uri: event?.uri ?? null,
      calendly_event_type_name: event?.name ?? null,
    }).eq("id", interviewer.id).eq("org_id", orgId);
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/settings/company");
  redirect("/settings/integrations?saved=1");
}

export async function disconnectCalendly() {
  const { profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const admin = createAdminClient();
  const connection = await getCalendlyConnection(orgId);

  if (connection?.webhook_subscription_uri) {
    try {
      await deleteCalendlyWebhookSubscription(orgId, connection.webhook_subscription_uri);
    } catch (error) {
      await recordOperationalEvent({ severity: "warning", source: "calendly", eventType: "remote_webhook_delete_failed", orgId, message: error instanceof Error ? error.message : "Remote Calendly webhook delete failed" });
    }
  }

  await Promise.all([
    admin.from("interviewers").update({ calendly_event_type_uri: null, calendly_event_type_name: null }).eq("org_id", orgId),
    admin.from("calendly_connections").delete().eq("org_id", orgId),
    admin.from("integrations").upsert({
      id: "calendly",
      org_id: orgId,
      name: "Calendly",
      icon: "calendar_month",
      connected: false,
      account: null,
      last_synced: new Date().toISOString(),
      config: null,
    }, { onConflict: "id,org_id" }),
  ]);

  revalidatePath("/settings/integrations");
  redirect("/settings/integrations?disconnected=1");
}
