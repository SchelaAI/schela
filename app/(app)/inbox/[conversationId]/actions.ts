"use server";

import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import { normalizeWhatsAppNumber } from "@/lib/whatsapp/phone";
import { sendHumanWhatsAppMessage } from "@/lib/whatsapp/outreach";
import { sendCandidateEmail } from "@/lib/email/client";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

export async function sendManualMessage(formData: FormData) {
  const conversationId = value(formData, "conversationId");
  const text = value(formData, "text");
  const channel = value(formData, "channel");
  if (!conversationId || !text || text.length > 3000 || !["wa", "em"].includes(channel)) {
    redirect(`/inbox/${encodeURIComponent(conversationId)}?error=Enter%20a%20valid%20message`);
  }

  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const limit = await consumeRateLimit({ scope: "manual_message", identifier: orgId, limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    redirect(`/inbox/${encodeURIComponent(conversationId)}?error=Message%20rate%20limit%20reached.%20Please%20wait%20a%20moment.`);
  }

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id,candidate_id,interview_id")
    .eq("id", conversationId)
    .eq("org_id", orgId)
    .single();
  if (!conversation?.interview_id) redirect("/inbox?error=Conversation%20not%20found");

  const [{ data: candidate }, { data: interview }, { data: organization }] = await Promise.all([
    supabase
      .from("candidates")
      .select("id,name,email,country_code,phone,phone_e164")
      .eq("id", conversation.candidate_id)
      .eq("org_id", orgId)
      .single(),
    supabase
      .from("interviews")
      .select("id,last_candidate_reply_at,role_title")
      .eq("id", conversation.interview_id)
      .eq("org_id", orgId)
      .single(),
    supabase.from("organizations").select("name").eq("id", orgId).single(),
  ]);

  if (!candidate || !interview || !organization) {
    redirect(`/inbox/${conversationId}?error=Conversation%20context%20is%20incomplete`);
  }

  if (channel === "em") {
    const { data: latestEmail } = await supabase
      .from("messages")
      .select("email_subject")
      .eq("conversation_id", conversationId)
      .eq("org_id", orgId)
      .eq("channel", "em")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    try {
      const subjectBase = latestEmail?.email_subject?.replace(/^Re:\s*/i, "").trim()
        || `Interview scheduling: ${interview.role_title || "Interview"} at ${organization.name}`;
      await sendCandidateEmail({
        orgId,
        candidateId: candidate.id,
        candidateEmail: candidate.email,
        conversationId,
        interviewId: interview.id,
        subject: `Re: ${subjectBase}`,
        text,
        senderKind: "human",
        senderName: profile.full_name || profile.email || "Recruiter",
        thread: true,
      });
    } catch (error) {
      await recordOperationalEvent({
        severity: "error",
        source: "resend",
        eventType: "manual_email_failed",
        orgId,
        conversationId,
        interviewId: interview.id,
        message: safeErrorMessage(error, "Manual email failed"),
      });
      redirect(`/inbox/${conversationId}?error=Email%20delivery%20failed.%20Please%20try%20again.`);
    }

    redirect(`/inbox/${conversationId}?sent=email`);
  }

  if (!interview.last_candidate_reply_at) {
    redirect(`/inbox/${conversationId}?error=${encodeURIComponent("Free-form WhatsApp messages become available after the candidate replies. Use an approved template for business-initiated outreach.")}`);
  }

  const replyAt = new Date(interview.last_candidate_reply_at).getTime();
  if (!Number.isFinite(replyAt) || Date.now() - replyAt > 24 * 60 * 60 * 1000) {
    redirect(`/inbox/${conversationId}?error=${encodeURIComponent("The WhatsApp customer-service window is no longer active for this thread. A template message is required to reopen outreach.")}`);
  }

  const candidateWaId = candidate.phone_e164 || normalizeWhatsAppNumber(candidate.country_code, candidate.phone);
  const result = await sendHumanWhatsAppMessage({
    orgId,
    conversationId,
    candidateName: candidate.name,
    candidateWaId,
    senderName: profile.full_name || profile.email || "Recruiter",
    text,
  });

  if (!result.ok) {
    await recordOperationalEvent({
      severity: "error",
      source: "whatsapp",
      eventType: "manual_message_failed",
      orgId,
      conversationId,
      interviewId: interview.id,
      message: result.error,
    });
    redirect(`/inbox/${conversationId}?error=WhatsApp%20delivery%20failed.%20Please%20try%20again.`);
  }

  redirect(`/inbox/${conversationId}?sent=wa`);
}
