import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppSendConfig } from "./config";
import { normalizeWhatsAppNumber } from "./phone";
import { sendWhatsAppInterviewTemplate, sendWhatsAppText } from "./client";

const ROUTE_DAYS = 30;

function errorText(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1500) : "Unknown WhatsApp error";
}

export async function sendInitialWhatsAppOutreach(input: {
  orgId: string;
  interviewId: number;
  conversationId: string;
  candidateId: string;
  candidateName: string;
  countryCode: string;
  phone: string;
  phoneE164?: string | null;
  companyName: string;
  roleTitle: string;
}) {
  const admin = createAdminClient();
  const config = getWhatsAppSendConfig();
  const to = input.phoneE164 || normalizeWhatsAppNumber(input.countryCode, input.phone);
  if (!to) throw new Error("Candidate has no valid WhatsApp phone number");

  const expiresAt = new Date(Date.now() + ROUTE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: routeClaimed, error: routeError } = await admin.rpc(
    "claim_whatsapp_thread_route",
    {
      p_sender_phone_number_id: config.phoneNumberId,
      p_candidate_wa_id: to,
      p_org_id: input.orgId,
      p_candidate_id: input.candidateId,
      p_conversation_id: input.conversationId,
      p_interview_id: input.interviewId,
      p_expires_at: expiresAt,
    },
  );

  if (routeError) throw new Error(`Could not claim WhatsApp route: ${routeError.message}`);
  if (!routeClaimed) {
    throw new Error(
      "This phone number already has another active Schela interview on the shared WhatsApp sender. Finish or expire that thread before starting another one.",
    );
  }

  const visibleText = `Hi ${input.candidateName}, I'm Schela, the scheduling assistant for ${input.companyName}. I'm helping coordinate your interview for the ${input.roleTitle} role. Reply here and I'll help you find a time that works.`;
  const { data: message, error: insertError } = await admin
    .from("messages")
    .insert({
      org_id: input.orgId,
      conversation_id: input.conversationId,
      from_role: "schela",
      sender_kind: "ai",
      sender_name: "Schela",
      text: visibleText,
      channel: "wa",
      delivered: false,
      delivery_status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !message) {
    await admin
      .from("whatsapp_thread_routes")
      .delete()
      .eq("sender_phone_number_id", config.phoneNumberId)
      .eq("candidate_wa_id", to)
      .eq("conversation_id", input.conversationId);
    throw new Error(insertError?.message ?? "Could not create outbound WhatsApp message row");
  }

  try {
    const result = await sendWhatsAppInterviewTemplate({
      to,
      candidateName: input.candidateName,
      companyName: input.companyName,
      roleTitle: input.roleTitle,
    });

    const sentAt = new Date().toISOString();
    await Promise.all([
      admin
        .from("messages")
        .update({
          whatsapp_message_id: result.messageId,
          delivery_status: "accepted",
          delivery_error: null,
        })
        .eq("id", message.id)
        .eq("org_id", input.orgId),
      admin
        .from("interviews")
        .update({ initial_outreach_sent_at: sentAt, ai_state: "waiting_reply" })
        .eq("id", input.interviewId)
        .eq("org_id", input.orgId),
      admin
        .from("candidates")
        .update({ ai_state: "waiting_reply", phone_e164: to, updated_at: sentAt })
        .eq("id", input.candidateId)
        .eq("org_id", input.orgId),
      admin
        .from("conversations")
        .update({
          updated_at: sentAt,
          escalated: false,
          escalation_reason: null,
        })
        .eq("id", input.conversationId)
        .eq("org_id", input.orgId),
    ]);

    return { ok: true as const, messageId: result.messageId };
  } catch (error) {
    const reason = errorText(error);
    await Promise.all([
      admin
        .from("whatsapp_thread_routes")
        .delete()
        .eq("sender_phone_number_id", config.phoneNumberId)
        .eq("candidate_wa_id", to)
        .eq("conversation_id", input.conversationId),
      admin
        .from("messages")
        .update({ delivery_status: "failed", delivery_error: reason, delivered: false })
        .eq("id", message.id)
        .eq("org_id", input.orgId),
      admin
        .from("interviews")
        .update({ ai_state: "escalated" })
        .eq("id", input.interviewId)
        .eq("org_id", input.orgId),
      admin
        .from("conversations")
        .update({ escalated: true, escalation_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", input.conversationId)
        .eq("org_id", input.orgId),
    ]);
    return { ok: false as const, error: reason };
  }
}

export async function sendHumanWhatsAppMessage(input: {
  orgId: string;
  conversationId: string;
  candidateName: string;
  candidateWaId: string;
  senderName: string;
  text: string;
}) {
  const admin = createAdminClient();
  const { data: row, error: insertError } = await admin
    .from("messages")
    .insert({
      org_id: input.orgId,
      conversation_id: input.conversationId,
      from_role: "schela",
      sender_kind: "human",
      sender_name: input.senderName || "Recruiter",
      text: input.text,
      channel: "wa",
      delivered: false,
      delivery_status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !row) throw new Error(insertError?.message ?? "Could not save message");

  try {
    const result = await sendWhatsAppText({ to: input.candidateWaId, text: input.text });
    await Promise.all([
      admin
        .from("messages")
        .update({ whatsapp_message_id: result.messageId, delivery_status: "accepted", delivery_error: null })
        .eq("id", row.id)
        .eq("org_id", input.orgId),
      admin
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", input.conversationId)
        .eq("org_id", input.orgId),
    ]);
    return { ok: true as const };
  } catch (error) {
    const reason = errorText(error);
    await admin
      .from("messages")
      .update({ delivery_status: "failed", delivery_error: reason, delivered: false })
      .eq("id", row.id)
      .eq("org_id", input.orgId);
    return { ok: false as const, error: reason };
  }
}

export async function sendAiWhatsAppMessage(input: {
  orgId: string;
  conversationId: string;
  candidateWaId: string;
  text: string;
}) {
  const admin = createAdminClient();
  const { data: row, error: insertError } = await admin
    .from("messages")
    .insert({
      org_id: input.orgId,
      conversation_id: input.conversationId,
      from_role: "schela",
      sender_kind: "ai",
      sender_name: "Schela",
      text: input.text,
      channel: "wa",
      delivered: false,
      delivery_status: "pending",
    })
    .select("id")
    .single();

  if (insertError || !row) throw new Error(insertError?.message ?? "Could not save AI WhatsApp reply");

  try {
    const result = await sendWhatsAppText({ to: input.candidateWaId, text: input.text });
    await Promise.all([
      admin
        .from("messages")
        .update({ whatsapp_message_id: result.messageId, delivery_status: "accepted", delivery_error: null })
        .eq("id", row.id)
        .eq("org_id", input.orgId),
      admin
        .from("conversations")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", input.conversationId)
        .eq("org_id", input.orgId),
    ]);
    return { messageRowId: row.id as number, providerMessageId: result.messageId };
  } catch (error) {
    const reason = errorText(error);
    await admin
      .from("messages")
      .update({ delivery_status: "failed", delivery_error: reason, delivered: false })
      .eq("id", row.id)
      .eq("org_id", input.orgId);
    throw new Error(reason);
  }
}
