import "server-only";

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCandidateEmail } from "@/lib/email/client";
import { sendAiWhatsAppMessage } from "@/lib/whatsapp/outreach";
import { makeSchelaDecision } from "./client";
import { cancelCalendlyInterview, createInterviewSchedulingLink } from "@/lib/calendly/client";
import { recordOperationalEvent } from "@/lib/observability/events";

function shortError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 1200) : "Unknown AI orchestration error";
}

async function claimAiRun(input: { inboundMessageId: number; orgId: string; conversationId: string }) {
  const admin = createAdminClient();
  const { error } = await admin.from("ai_message_runs").insert({
    inbound_message_id: input.inboundMessageId,
    org_id: input.orgId,
    conversation_id: input.conversationId,
    status: "processing",
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(`Could not claim AI message run: ${error.message}`);
}

async function markAiRun(input: {
  inboundMessageId: number;
  status: "completed" | "failed";
  error?: string | null;
}) {
  const admin = createAdminClient();
  await admin
    .from("ai_message_runs")
    .update({
      status: input.status,
      completed_at: new Date().toISOString(),
      error: input.error ?? null,
    })
    .eq("inbound_message_id", input.inboundMessageId);
}

function actionCategory(intent: string, lowConfidence: boolean) {
  if (lowConfidence) return "low_confidence";
  if (intent === "compensation") return "compensation";
  if (intent === "visa") return "visa";
  return "manual_approval";
}

async function createEscalation(input: {
  orgId: string;
  candidateId: string;
  conversationId: string;
  interviewId: number;
  summary: string;
  confidence?: number | null;
  category: string;
}) {
  const admin = createAdminClient();
  const id = `action_${randomUUID().replaceAll("-", "")}`;
  await Promise.all([
    admin.from("action_items").insert({
      id,
      org_id: input.orgId,
      category: input.category,
      candidate_id: input.candidateId,
      conversation_id: input.conversationId,
      interview_id: input.interviewId,
      summary: input.summary,
      confidence: input.confidence ?? null,
      resolved: false,
    }),
    admin.from("notifications").insert({
      org_id: input.orgId,
      type: "escalated",
      title: "Schela needs review",
      description: input.summary.slice(0, 500),
      link_candidate_id: input.candidateId,
      link_conversation_id: input.conversationId,
      link_interview_id: input.interviewId,
    }),
    admin
      .from("conversations")
      .update({ escalated: true, escalation_reason: input.summary, updated_at: new Date().toISOString() })
      .eq("id", input.conversationId)
      .eq("org_id", input.orgId),
    admin
      .from("interviews")
      .update({ ai_state: "escalated" })
      .eq("id", input.interviewId)
      .eq("org_id", input.orgId),
    admin
      .from("candidates")
      .update({ ai_state: "escalated", updated_at: new Date().toISOString() })
      .eq("id", input.candidateId)
      .eq("org_id", input.orgId),
  ]);
}

async function sendReply(input: {
  channel: "wa" | "em";
  orgId: string;
  candidateId: string;
  candidateEmail: string;
  candidateWaId?: string | null;
  conversationId: string;
  interviewId: number;
  companyName: string;
  roleTitle: string;
  text: string;
  latestEmailSubject?: string | null;
}) {
  if (input.channel === "wa") {
    if (!input.candidateWaId) throw new Error("Candidate WhatsApp id is unavailable for AI reply");
    return sendAiWhatsAppMessage({
      orgId: input.orgId,
      conversationId: input.conversationId,
      candidateWaId: input.candidateWaId,
      text: input.text,
    });
  }

  const baseSubject = `Interview scheduling: ${input.roleTitle} at ${input.companyName}`;
  const prior = input.latestEmailSubject?.replace(/^Re:\s*/i, "").trim();
  const subject = `Re: ${prior || baseSubject}`;
  return sendCandidateEmail({
    orgId: input.orgId,
    candidateId: input.candidateId,
    candidateEmail: input.candidateEmail,
    conversationId: input.conversationId,
    interviewId: input.interviewId,
    subject,
    text: input.text,
    thread: true,
  });
}

export async function orchestrateCandidateMessage(input: {
  inboundMessageId: number;
  orgId: string;
  conversationId: string;
  channel: "wa" | "em";
  candidateWaId?: string | null;
}) {
  const claimed = await claimAiRun(input);
  if (!claimed) return { ok: true as const, duplicate: true as const };

  const admin = createAdminClient();

  try {
    const { data: conversation } = await admin
      .from("conversations")
      .select("candidate_id,interview_id")
      .eq("id", input.conversationId)
      .eq("org_id", input.orgId)
      .single();

    if (!conversation?.interview_id) throw new Error("Conversation has no interview context");

    const [{ data: candidate }, { data: interview }, { data: organization }, { data: owner }, { data: history }] = await Promise.all([
      admin
        .from("candidates")
        .select("id,name,email")
        .eq("id", conversation.candidate_id)
        .eq("org_id", input.orgId)
        .single(),
      admin
        .from("interviews")
        .select("id,role_title,interviewer,duration_minutes,scheduled_at,calendly_event_uri,calendly_reschedule_url")
        .eq("id", conversation.interview_id)
        .eq("org_id", input.orgId)
        .single(),
      admin.from("organizations").select("name").eq("id", input.orgId).single(),
      admin
        .from("profiles")
        .select("ai_confidence_threshold,ai_auto_execute,ai_log_decisions")
        .eq("org_id", input.orgId)
        .limit(1)
        .maybeSingle(),
      admin
        .from("messages")
        .select("id,from_role,text,channel,email_subject,created_at")
        .eq("conversation_id", input.conversationId)
        .eq("org_id", input.orgId)
        .order("created_at", { ascending: false })
        .limit(24),
    ]);

    if (!candidate || !interview || !organization) throw new Error("AI context is incomplete");

    const orderedHistory = (history ?? []).reverse();
    const latestEmailSubject = [...orderedHistory]
      .reverse()
      .find((row) => row.channel === "em" && row.email_subject)?.email_subject ?? null;

    const ai = await makeSchelaDecision({
      companyName: organization.name,
      candidateName: candidate.name,
      roleTitle: interview.role_title || "interview",
      interviewerName: interview.interviewer,
      durationMinutes: interview.duration_minutes,
      scheduledAt: interview.scheduled_at,
      channel: input.channel,
      history: orderedHistory.map((row) => ({
        fromRole: row.from_role,
        text: row.text,
        channel: row.channel,
      })),
    });

    const threshold = Math.max(0, Math.min(100, owner?.ai_confidence_threshold ?? 65)) / 100;
    const lowConfidence = ai.decision.confidence < threshold || ai.decision.ambiguities.length > 0;
    const autoExecute = owner?.ai_auto_execute ?? true;
    const executableCalendarAction =
      ai.decision.action === "needs_calendar" &&
      ["availability", "scheduling", "reschedule"].includes(ai.decision.intent);
    const executableCloseAction =
      ai.decision.action === "close" && ["cancel", "withdraw"].includes(ai.decision.intent);
    const requiresHuman =
      !autoExecute ||
      lowConfidence ||
      ai.decision.action === "escalate" ||
      (ai.decision.action !== "reply" && !executableCalendarAction && !executableCloseAction);

    if (owner?.ai_log_decisions ?? true) {
      await admin.from("ai_decisions").insert({
        org_id: input.orgId,
        conversation_id: input.conversationId,
        message_id: input.inboundMessageId,
        tier: requiresHuman ? "human" : "tier2",
        model: ai.model,
        intent: ai.decision.intent,
        confidence: ai.decision.confidence,
        action_taken: requiresHuman ? ai.decision.action : "auto_reply",
        input_tokens: ai.inputTokens,
        output_tokens: ai.outputTokens,
        reasoning: ai.decision.audit_rationale,
        ambiguities: ai.decision.ambiguities,
        escalation_reason: requiresHuman
          ? lowConfidence
            ? `Confidence ${Math.round(ai.decision.confidence * 100)}% is below the workspace threshold or the message is ambiguous.`
            : `AI action requires review: ${ai.decision.action}.`
          : null,
      });
    }

    let reply = ai.decision.reply;
    let escalationSummary: string | null = null;

    if (!autoExecute) {
      reply = "Thanks — I’ve got your message. I’ll have the recruiting team follow up with you shortly.";
      escalationSummary = "AI auto-execution is disabled for this workspace.";
    } else if (lowConfidence) {
      reply = "Thanks — I’ve got your message. I’ll have the recruiting team follow up so this is handled correctly.";
      escalationSummary = `Schela was not confident enough to act automatically (${Math.round(ai.decision.confidence * 100)}%).`;
    } else if (executableCalendarAction) {
      if (ai.decision.intent === "reschedule" && interview.calendly_reschedule_url) {
        reply = `Absolutely — you can choose a new time here: ${interview.calendly_reschedule_url}`;
      } else {
        const link = await createInterviewSchedulingLink({
          orgId: input.orgId,
          interviewId: interview.id,
          conversationId: input.conversationId,
          candidateId: candidate.id,
          candidateName: candidate.name,
          candidateEmail: candidate.email,
        });
        reply = ai.decision.intent === "reschedule"
          ? `Absolutely — choose a new interview time that works for you here: ${link.bookingUrl}`
          : `Sure — choose the interview time that works best for you here: ${link.bookingUrl}`;
      }
    } else if (ai.decision.action === "escalate") {
      reply = "Thanks for asking. I’ll have the recruiting team follow up with you directly on that.";
      escalationSummary = `Candidate asked about ${ai.decision.intent.replaceAll("_", " ")}; recruiter review is required.`;
    } else if (executableCloseAction) {
      // Mark the workflow closed BEFORE calling Calendly. Its cancellation
      // webhook uses this state to distinguish a final candidate cancellation
      // from a normal cancellation that should trigger re-coordination.
      await Promise.all([
        admin
          .from("interviews")
          .update({ ai_state: "completed", updated_at: new Date().toISOString() })
          .eq("id", interview.id)
          .eq("org_id", input.orgId),
        admin
          .from("candidates")
          .update({ ai_state: "completed", updated_at: new Date().toISOString() })
          .eq("id", candidate.id)
          .eq("org_id", input.orgId),
      ]);
      if (interview.calendly_event_uri) {
        await cancelCalendlyInterview({
          orgId: input.orgId,
          eventUri: interview.calendly_event_uri,
          reason: ai.decision.intent === "withdraw"
            ? "Candidate withdrew through Schela."
            : "Candidate requested cancellation through Schela.",
        });
      }
      reply = ai.decision.intent === "withdraw"
        ? "Understood. I’ve recorded that you’re withdrawing from this interview process and cancelled any active booking."
        : "Understood. I’ve cancelled the interview booking. If you need to schedule again later, just reply here.";
    } else if (ai.decision.action === "close") {
      escalationSummary = `Candidate requested ${ai.decision.intent.replaceAll("_", " ")}; recruiter review is required.`;
    }

    // Even when a human/calendar action is needed, send a safe acknowledgement
    // so the candidate is not left staring at a silent automation.
    await sendReply({
      channel: input.channel,
      orgId: input.orgId,
      candidateId: candidate.id,
      candidateEmail: candidate.email,
      candidateWaId: input.candidateWaId,
      conversationId: input.conversationId,
      interviewId: interview.id,
      companyName: organization.name,
      roleTitle: interview.role_title || "Interview",
      text: reply,
      latestEmailSubject,
    });

    if (requiresHuman || escalationSummary) {
      await createEscalation({
        orgId: input.orgId,
        candidateId: candidate.id,
        conversationId: input.conversationId,
        interviewId: interview.id,
        summary: escalationSummary || "Schela requires recruiter review before continuing.",
        confidence: ai.decision.confidence,
        category: actionCategory(ai.decision.intent, lowConfidence),
      });
    } else {
      await Promise.all([
        admin
          .from("conversations")
          .update({
            confidence: ai.decision.confidence,
            escalated: false,
            escalation_reason: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", input.conversationId)
          .eq("org_id", input.orgId),
        executableCloseAction
          ? Promise.resolve()
          : admin
              .from("interviews")
              .update({ ai_state: "scheduling" })
              .eq("id", interview.id)
              .eq("org_id", input.orgId),
      ]);
    }

    await markAiRun({ inboundMessageId: input.inboundMessageId, status: "completed" });
    return { ok: true as const, duplicate: false as const, action: ai.decision.action };
  } catch (error) {
    const reason = shortError(error);
    await markAiRun({ inboundMessageId: input.inboundMessageId, status: "failed", error: reason });
    await recordOperationalEvent({
      severity: "error",
      source: "ai",
      eventType: "orchestration_failed",
      orgId: input.orgId,
      conversationId: input.conversationId,
      message: reason,
    });

    // AI/provider failure is surfaced to the recruiter rather than retrying
    // blindly and risking a duplicate candidate-facing reply.
    const { data: conversation } = await admin
      .from("conversations")
      .select("candidate_id,interview_id")
      .eq("id", input.conversationId)
      .eq("org_id", input.orgId)
      .maybeSingle();

    if (conversation?.interview_id && conversation.candidate_id) {
      await createEscalation({
        orgId: input.orgId,
        candidateId: conversation.candidate_id,
        conversationId: input.conversationId,
        interviewId: conversation.interview_id,
        summary: "Schela could not complete the automatic reply. Please review this conversation before continuing.",
        category: "manual_approval",
      });
    }

    return { ok: false as const, error: "Automatic reply requires recruiter review" };
  }
}
