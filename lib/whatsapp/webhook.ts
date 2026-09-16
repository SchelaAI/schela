import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { WhatsAppStatus, WhatsAppTextMessage } from "./types";

function inboundText(message: WhatsAppTextMessage) {
  if (message.type === "text") return message.text?.body?.trim() || "";
  if (message.type === "interactive") {
    return (
      message.interactive?.button_reply?.title ||
      message.interactive?.list_reply?.title ||
      "[Interactive WhatsApp response]"
    );
  }
  if (message.type === "button") return message.button?.text || "[WhatsApp button response]";
  return `[${message.type || "Unsupported"} WhatsApp message]`;
}

async function claimEvent(eventId: string, eventType: string) {
  const admin = createAdminClient();
  const { error } = await admin.from("webhook_events").insert({
    provider: "whatsapp",
    event_id: eventId,
    event_type: eventType,
    payload: null,
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Could not claim WhatsApp webhook event: ${error.message}`);
}

async function releaseEvent(eventId: string) {
  const admin = createAdminClient();
  await admin
    .from("webhook_events")
    .delete()
    .eq("provider", "whatsapp")
    .eq("event_id", eventId);
}

export async function processWhatsAppStatus(status: WhatsAppStatus, payload: unknown) {
  const eventId = `status:${status.id}:${status.status}:${status.timestamp ?? ""}`;
  const claimed = await claimEvent(eventId, `message.${status.status}`);
  if (!claimed) return;

  try {
    const admin = createAdminClient();
    const { data: message } = await admin
      .from("messages")
      .select("id,org_id,conversation_id,provider_status_at")
      .eq("whatsapp_message_id", status.id)
      .maybeSingle();

    if (!message) {
      // A status callback can race the HTTP send response before we have saved
      // the returned wamid on the outbound row. Let Meta retry instead of
      // permanently dropping the delivery state.
      await releaseEvent(eventId);
      throw new Error(`WhatsApp status arrived before outbound message ${status.id} was persisted`);
    }

    const incomingStatusAt = status.timestamp
      ? new Date(Number(status.timestamp) * 1000)
      : new Date();
    const currentStatusAt = message.provider_status_at
      ? new Date(message.provider_status_at)
      : null;

    // Meta notes status callbacks can arrive out of order. The provider's
    // timestamp is therefore authoritative; do not let an older callback
    // downgrade a newer state (for example read -> delivered -> sent).
    if (
      currentStatusAt &&
      Number.isFinite(currentStatusAt.getTime()) &&
      incomingStatusAt.getTime() < currentStatusAt.getTime()
    ) {
      return;
    }

    const normalizedStatus = ["sent", "delivered", "read", "failed"].includes(status.status)
      ? status.status
      : "accepted";
    const delivered = status.status === "delivered" || status.status === "read";
    const providerError = status.errors?.length
      ? JSON.stringify(status.errors).slice(0, 1500)
      : null;

    await admin
      .from("messages")
      .update({
        delivery_status: normalizedStatus,
        delivered,
        delivery_error:
          status.status === "failed" ? providerError || "WhatsApp delivery failed" : null,
        provider_status_at: incomingStatusAt.toISOString(),
      })
      .eq("id", message.id)
      .eq("org_id", message.org_id);

    await admin
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", message.conversation_id)
      .eq("org_id", message.org_id);
  } catch (error) {
    await releaseEvent(eventId);
    throw error;
  }
}

export async function processInboundWhatsAppMessage(input: {
  senderPhoneNumberId: string;
  message: WhatsAppTextMessage;
  payload: unknown;
  contactName?: string | null;
}) {
  const eventId = `message:${input.message.id}`;
  const claimed = await claimEvent(eventId, "message.received");
  if (!claimed) return;

  try {
    const admin = createAdminClient();
    const { data: route } = await admin
      .from("whatsapp_thread_routes")
      .select("org_id,candidate_id,conversation_id,interview_id,expires_at")
      .eq("sender_phone_number_id", input.senderPhoneNumberId)
      .eq("candidate_wa_id", input.message.from)
      .maybeSingle();

    if (!route || new Date(route.expires_at).getTime() <= Date.now()) {
      await admin.from("whatsapp_unmatched_messages").upsert(
        {
          whatsapp_message_id: input.message.id,
          sender_phone_number_id: input.senderPhoneNumberId,
          candidate_wa_id: input.message.from,
          message_type: input.message.type,
          text: inboundText(input.message),
          reason: route ? "route_expired" : "no_active_route",
          payload: null,
        },
        { onConflict: "whatsapp_message_id" },
      );
      return null;
    }

    const { data: candidate } = await admin
      .from("candidates")
      .select("name")
      .eq("id", route.candidate_id)
      .eq("org_id", route.org_id)
      .maybeSingle();

    const createdAt = input.message.timestamp
      ? new Date(Number(input.message.timestamp) * 1000).toISOString()
      : new Date().toISOString();
    const text = inboundText(input.message);

    const { data: insertedMessage, error: messageError } = await admin
      .from("messages")
      .insert({
        org_id: route.org_id,
        conversation_id: route.conversation_id,
        from_role: "candidate",
        sender_kind: "candidate",
        sender_name: input.contactName || candidate?.name || "Candidate",
        text,
        channel: "wa",
        whatsapp_message_id: input.message.id,
        delivered: true,
        delivery_status: "received",
        provider_status_at: createdAt,
        created_at: createdAt,
      })
      .select("id")
      .single();

    if (messageError) {
      throw new Error(`Could not persist inbound WhatsApp message: ${messageError.message}`);
    }

    const now = new Date().toISOString();
    const routeExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await Promise.all([
      admin
        .from("interviews")
        .update({ last_candidate_reply_at: now, ai_state: "scheduling" })
        .eq("id", route.interview_id)
        .eq("org_id", route.org_id),
      admin
        .from("candidates")
        .update({ ai_state: "scheduling", updated_at: now })
        .eq("id", route.candidate_id)
        .eq("org_id", route.org_id),
      admin
        .from("conversations")
        .update({ unread: true, updated_at: now })
        .eq("id", route.conversation_id)
        .eq("org_id", route.org_id),
      admin
        .from("whatsapp_thread_routes")
        .update({ expires_at: routeExpiry })
        .eq("sender_phone_number_id", input.senderPhoneNumberId)
        .eq("candidate_wa_id", input.message.from),
    ]);

    return {
      inboundMessageId: insertedMessage.id as number,
      orgId: route.org_id as string,
      conversationId: route.conversation_id as string,
      candidateWaId: input.message.from,
    };
  } catch (error) {
    await releaseEvent(eventId);
    throw error;
  }
}
