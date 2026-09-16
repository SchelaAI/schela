"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInitialWhatsAppOutreach } from "@/lib/whatsapp/outreach";
import { sendInitialEmailOutreach } from "@/lib/email/outreach";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

const allowedFormats = new Set(["Calendly", "Google Meet", "Zoom", "Phone", "In-person"]);

export async function createInterview(formData: FormData) {
  const { supabase, profile } = await requireAppUser();
  const orgId = profile.org_id!;
  const limit = await consumeRateLimit({ scope: "interview_create", identifier: orgId, limit: 40, windowSeconds: 3600 });
  if (!limit.allowed) redirect("/interviews/new?error=Too%20many%20interview%20requests.%20Please%20try%20again%20later.");

  const candidateId = value(formData, "candidateId");
  const interviewerId = value(formData, "interviewerId");
  const roleTitle = value(formData, "roleTitle");
  const duration = Number(value(formData, "duration") || "45");
  const format = value(formData, "format") || "Calendly";
  const channel = value(formData, "channel") || "wa";

  if (
    !candidateId ||
    !interviewerId ||
    !roleTitle ||
    roleTitle.length > 180 ||
    !Number.isInteger(duration) ||
    duration < 10 ||
    duration > 480 ||
    !allowedFormats.has(format) ||
    !["wa", "em"].includes(channel)
  ) {
    redirect("/interviews/new?error=Enter%20valid%20candidate,%20interviewer,%20role,%20duration,%20format,%20and%20channel%20values");
  }

  const [{ data: candidate }, { data: interviewer }, { data: organization }] = await Promise.all([
    supabase
      .from("candidates")
      .select("id,name,email,country_code,phone,phone_e164")
      .eq("id", candidateId)
      .eq("org_id", orgId)
      .single(),
    supabase
      .from("interviewers")
      .select("id,name")
      .eq("id", interviewerId)
      .eq("org_id", orgId)
      .single(),
    supabase.from("organizations").select("name").eq("id", orgId).single(),
  ]);

  if (!candidate || !interviewer || !organization) {
    redirect("/interviews/new?error=Candidate,%20interviewer,%20or%20company%20does%20not%20belong%20to%20this%20workspace");
  }

  const admin = createAdminClient();
  let calendlyEventTypeUri: string | null = null;
  if (format === "Calendly") {
    const [{ data: privateInterviewer }, { data: connection }] = await Promise.all([
      admin
        .from("interviewers")
        .select("calendly_event_type_uri")
        .eq("id", interviewer.id)
        .eq("org_id", orgId)
        .maybeSingle(),
      admin
        .from("calendly_connections")
        .select("default_event_type_uri")
        .eq("org_id", orgId)
        .maybeSingle(),
    ]);
    calendlyEventTypeUri = privateInterviewer?.calendly_event_type_uri || connection?.default_event_type_uri || null;
    if (!calendlyEventTypeUri) {
      redirect("/interviews/new?error=Connect%20Calendly%20and%20choose%20an%20event%20type%20before%20creating%20a%20Calendly%20interview");
    }
  }

  const { data: interview, error } = await admin
    .from("interviews")
    .insert({
      org_id: orgId,
      candidate_id: candidateId,
      scheduled_at: null,
      duration_minutes: duration,
      format,
      channel,
      ai_state: "sending_invitation",
      interviewer: interviewer.name,
      interviewer_id: interviewer.id,
      role_title: roleTitle.slice(0, 180),
      calendly_event_type_uri: calendlyEventTypeUri,
      handled_by: "ai",
    })
    .select("id")
    .single();

  if (error || !interview) {
    await recordOperationalEvent({ severity: "error", source: "interviews", eventType: "interview_create_failed", orgId, message: error?.message || "Missing interview row" });
    redirect("/interviews/new?error=Could%20not%20create%20the%20interview.%20Please%20try%20again.");
  }

  const conversationId = `conv_${randomUUID().replaceAll("-", "")}`;
  const { error: conversationError } = await admin.from("conversations").insert({
    id: conversationId,
    org_id: orgId,
    candidate_id: candidateId,
    interview_id: interview.id,
    channel,
    primary_channel: channel,
    unread: false,
    escalated: false,
    updated_at: new Date().toISOString(),
  });

  if (conversationError) {
    await admin.from("interviews").delete().eq("id", interview.id).eq("org_id", orgId);
    await recordOperationalEvent({ severity: "error", source: "interviews", eventType: "conversation_create_failed", orgId, interviewId: interview.id, message: conversationError.message });
    redirect("/interviews?error=Could%20not%20create%20the%20conversation.%20Please%20try%20again.");
  }

  if (channel === "wa") {
    try {
      const result = await sendInitialWhatsAppOutreach({
        orgId,
        interviewId: interview.id,
        conversationId,
        candidateId: candidate.id,
        candidateName: candidate.name,
        countryCode: candidate.country_code,
        phone: candidate.phone,
        phoneE164: candidate.phone_e164,
        companyName: organization.name,
        roleTitle,
      });
      if (!result.ok) throw new Error(result.error);
      redirect(`/inbox/${conversationId}?outreach=sent`);
    } catch (outreachError) {
      const reason = safeErrorMessage(outreachError, "Could not start WhatsApp outreach");
      await Promise.all([
        admin.from("interviews").update({ ai_state: "escalated" }).eq("id", interview.id).eq("org_id", orgId),
        admin.from("conversations").update({ escalated: true, escalation_reason: "Initial WhatsApp delivery failed" }).eq("id", conversationId).eq("org_id", orgId),
        recordOperationalEvent({ severity: "error", source: "whatsapp", eventType: "initial_outreach_failed", orgId, interviewId: interview.id, conversationId, message: reason }),
      ]);
      redirect(`/inbox/${conversationId}?deliveryError=WhatsApp%20delivery%20failed.%20Check%20the%20integration%20and%20try%20again.`);
    }
  }

  try {
    const emailResult = await sendInitialEmailOutreach({
      orgId,
      interviewId: interview.id,
      conversationId,
      candidateId: candidate.id,
      candidateName: candidate.name,
      candidateEmail: candidate.email,
      companyName: organization.name,
      roleTitle,
    });
    if (!emailResult.ok) throw new Error(emailResult.error);
    redirect(`/inbox/${conversationId}?outreach=email-sent`);
  } catch (outreachError) {
    const reason = safeErrorMessage(outreachError, "Email delivery failed");
    await recordOperationalEvent({ severity: "error", source: "resend", eventType: "initial_outreach_failed", orgId, interviewId: interview.id, conversationId, message: reason });
    redirect(`/inbox/${conversationId}?deliveryError=Email%20delivery%20failed.%20Check%20the%20integration%20and%20try%20again.`);
  }
}
