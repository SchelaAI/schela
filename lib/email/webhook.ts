import "server-only";

import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { orchestrateCandidateMessage } from "@/lib/ai/orchestrator";
import { getResendApiKey } from "./config";
import { normalizeEmailAddress } from "./routing";

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function processInboundResendEmail(event: {
  data: {
    email_id: string;
    message_id?: string | null;
    from?: string;
    to?: string[];
    subject?: string;
  };
}) {
  const admin = createAdminClient();
  const resend = new Resend(getResendApiKey());
  const { data: received, error } = await resend.emails.receiving.get(event.data.email_id);
  if (error || !received) {
    throw new Error(`Could not retrieve received email: ${error ? JSON.stringify(error) : "missing email"}`);
  }

  const recipients = (received.to?.length ? received.to : event.data.to ?? [])
    .map(normalizeEmailAddress)
    .filter(Boolean);

  if (!recipients.length) {
    await admin.from("email_unmatched_messages").upsert({
      resend_email_id: event.data.email_id,
      email_message_id: event.data.message_id ?? (received as typeof received & { message_id?: string }).message_id ?? null,
      sender: received.from ?? event.data.from ?? null,
      subject: received.subject ?? event.data.subject ?? null,
      reason: "missing_recipient",
      payload: null,
    }, { onConflict: "resend_email_id" });
    return null;
  }

  const { data: routes } = await admin
    .from("email_thread_routes")
    .select("org_id,candidate_id,conversation_id,interview_id,inbound_address")
    .in("inbound_address", recipients);
  const route = routes?.[0];

  if (!route) {
    await admin.from("email_unmatched_messages").upsert({
      resend_email_id: event.data.email_id,
      email_message_id: event.data.message_id ?? (received as typeof received & { message_id?: string }).message_id ?? null,
      recipient: recipients.join(","),
      sender: received.from ?? event.data.from ?? null,
      subject: received.subject ?? event.data.subject ?? null,
      reason: "no_email_route",
      payload: null,
    }, { onConflict: "resend_email_id" });
    return null;
  }

  const { data: candidate } = await admin
    .from("candidates")
    .select("name,email")
    .eq("id", route.candidate_id)
    .eq("org_id", route.org_id)
    .single();

  if (!candidate) throw new Error("Email route points to a missing candidate");

  const sender = normalizeEmailAddress(received.from ?? event.data.from);
  if (!sender || sender !== normalizeEmailAddress(candidate.email)) {
    await admin.from("email_unmatched_messages").upsert({
      resend_email_id: event.data.email_id,
      email_message_id: event.data.message_id ?? (received as typeof received & { message_id?: string }).message_id ?? null,
      recipient: route.inbound_address,
      sender: received.from ?? event.data.from ?? null,
      subject: received.subject ?? event.data.subject ?? null,
      reason: "sender_does_not_match_candidate",
      payload: null,
    }, { onConflict: "resend_email_id" });
    return null;
  }

  const text = (received.text || (received.html ? stripHtml(received.html) : "")).trim();
  if (!text) {
    await admin.from("email_unmatched_messages").upsert({
      resend_email_id: event.data.email_id,
      email_message_id: event.data.message_id ?? (received as typeof received & { message_id?: string }).message_id ?? null,
      recipient: route.inbound_address,
      sender: received.from ?? event.data.from ?? null,
      subject: received.subject ?? event.data.subject ?? null,
      reason: "empty_email_body",
      payload: null,
    }, { onConflict: "resend_email_id" });
    return null;
  }

  const messageId = event.data.message_id ?? (received as typeof received & { message_id?: string }).message_id ?? null;
  const createdAt = received.created_at || new Date().toISOString();
  const { data: inserted, error: insertError } = await admin
    .from("messages")
    .insert({
      org_id: route.org_id,
      conversation_id: route.conversation_id,
      from_role: "candidate",
      sender_kind: "candidate",
      sender_name: candidate.name,
      text: text.slice(0, 12000),
      channel: "em",
      resend_email_id: event.data.email_id,
      email_message_id: messageId,
      email_subject: received.subject ?? event.data.subject ?? null,
      delivered: true,
      delivery_status: "received",
      provider_status_at: createdAt,
      created_at: createdAt,
    })
    .select("id")
    .single();

  let inboundMessageId = inserted?.id as number | undefined;
  if (insertError?.code === "23505") {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("resend_email_id", event.data.email_id)
      .maybeSingle();
    inboundMessageId = existing?.id as number | undefined;
  } else if (insertError) {
    throw new Error(insertError.message);
  }
  if (!inboundMessageId) throw new Error("Could not save or locate inbound email");

  const now = new Date().toISOString();
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
      .from("email_thread_routes")
      .update({ updated_at: now })
      .eq("org_id", route.org_id)
      .eq("conversation_id", route.conversation_id),
  ]);

  await orchestrateCandidateMessage({
    inboundMessageId,
    orgId: route.org_id,
    conversationId: route.conversation_id,
    channel: "em",
  });

  return { inboundMessageId, conversationId: route.conversation_id };
}

export async function processResendDeliveryEvent(event: {
  type: string;
  created_at?: string;
  data?: { email_id?: string; message_id?: string | null };
}) {
  const emailId = event.data?.email_id;
  if (!emailId) return;

  const admin = createAdminClient();
  const status =
    event.type === "email.delivered"
      ? "delivered"
      : event.type === "email.bounced" || event.type === "email.failed"
        ? "failed"
        : event.type === "email.sent"
          ? "sent"
          : "accepted";

  const update: Record<string, unknown> = {
    delivery_status: status,
    delivered: status === "delivered",
    provider_status_at: event.created_at ?? new Date().toISOString(),
  };

  if (event.data?.message_id) update.email_message_id = event.data.message_id;
  if (status === "failed") update.delivery_error = `Resend event: ${event.type}`;

  await admin.from("messages").update(update).eq("resend_email_id", emailId);
}
