import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendCandidateEmail } from "./client";

function initialCopy(candidateName: string, companyName: string, roleTitle: string) {
  return `Hi ${candidateName},\n\nI'm Schela, the scheduling assistant for ${companyName}. I'm helping coordinate your interview for the ${roleTitle} role.\n\nReply to this email with the days or times that work best for you, and I'll help coordinate the next step.`;
}

export async function sendInitialEmailOutreach(input: {
  orgId: string;
  interviewId: number;
  conversationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  companyName: string;
  roleTitle: string;
}) {
  const admin = createAdminClient();
  const subject = `Interview scheduling: ${input.roleTitle} at ${input.companyName}`;
  const text = initialCopy(input.candidateName, input.companyName, input.roleTitle);

  try {
    await sendCandidateEmail({
      orgId: input.orgId,
      candidateId: input.candidateId,
      candidateEmail: input.candidateEmail,
      conversationId: input.conversationId,
      interviewId: input.interviewId,
      subject,
      text,
      thread: false,
    });

    const sentAt = new Date().toISOString();
    await Promise.all([
      admin
        .from("interviews")
        .update({ initial_outreach_sent_at: sentAt, ai_state: "waiting_reply" })
        .eq("id", input.interviewId)
        .eq("org_id", input.orgId),
      admin
        .from("candidates")
        .update({ ai_state: "waiting_reply", updated_at: sentAt })
        .eq("id", input.candidateId)
        .eq("org_id", input.orgId),
      admin
        .from("conversations")
        .update({ escalated: false, escalation_reason: null, updated_at: sentAt })
        .eq("id", input.conversationId)
        .eq("org_id", input.orgId),
    ]);

    return { ok: true as const };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Email outreach failed";
    await Promise.all([
      admin.from("interviews").update({ ai_state: "escalated" }).eq("id", input.interviewId).eq("org_id", input.orgId),
      admin.from("conversations").update({ escalated: true, escalation_reason: reason }).eq("id", input.conversationId).eq("org_id", input.orgId),
    ]);
    return { ok: false as const, error: reason };
  }
}

export async function sendNoReplyEmailFallback(input: {
  orgId: string;
  interviewId: number;
  conversationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  companyName: string;
  roleTitle: string;
}) {
  const admin = createAdminClient();
  const subject = `Interview scheduling: ${input.roleTitle} at ${input.companyName}`;
  const text = `Hi ${input.candidateName},\n\nJust following up here in case WhatsApp wasn't convenient. I'm Schela, ${input.companyName}'s scheduling assistant, helping coordinate your ${input.roleTitle} interview.\n\nReply to this email with the days or times that work best for you and I'll continue from here.`;

  try {
    await sendCandidateEmail({
      orgId: input.orgId,
      candidateId: input.candidateId,
      candidateEmail: input.candidateEmail,
      conversationId: input.conversationId,
      interviewId: input.interviewId,
      subject,
      text,
      thread: false,
    });

    const sentAt = new Date().toISOString();
    await Promise.all([
      admin
        .from("interviews")
        .update({ followup_email_sent_at: sentAt, followup_email_claimed_at: null })
        .eq("id", input.interviewId)
        .eq("org_id", input.orgId),
      admin
        .from("conversations")
        .update({ updated_at: sentAt })
        .eq("id", input.conversationId)
        .eq("org_id", input.orgId),
    ]);
    return { ok: true as const };
  } catch (error) {
    await admin
      .from("interviews")
      .update({ followup_email_claimed_at: null })
      .eq("id", input.interviewId)
      .eq("org_id", input.orgId);
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : "Email fallback failed",
    };
  }
}
