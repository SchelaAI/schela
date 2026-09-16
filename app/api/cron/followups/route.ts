import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendNoReplyEmailFallback } from "@/lib/email/outreach";
import { sendDueInterviewReminder } from "@/lib/calendly/workflow";
import { noStoreHeaders, safeSecretEquals } from "@/lib/http/security";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 25;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) throw new Error("CRON_SECRET is not configured");
  const authorization = request.headers.get("authorization");
  return safeSecretEquals(authorization, `Bearer ${secret}`);
}

async function processNoReplyFallbacks() {
  const admin = createAdminClient();
  const { data: due, error } = await admin.rpc("claim_noreply_email_followups", { p_limit: 10 });
  if (error) throw new Error(error.message);

  const results = await Promise.all((due ?? []).map(async (claimed: { org_id: string; interview_id: number; candidate_id: string }) => {
    try {
      const [{ data: interview }, { data: candidate }, { data: organization }, { data: conversation }] = await Promise.all([
        admin.from("interviews").select("id,role_title").eq("id", claimed.interview_id).eq("org_id", claimed.org_id).single(),
        admin.from("candidates").select("id,name,email").eq("id", claimed.candidate_id).eq("org_id", claimed.org_id).single(),
        admin.from("organizations").select("name").eq("id", claimed.org_id).single(),
        admin.from("conversations").select("id").eq("interview_id", claimed.interview_id).eq("org_id", claimed.org_id).single(),
      ]);
      if (!interview || !candidate || !organization || !conversation) throw new Error("Follow-up context is incomplete");

      const result = await sendNoReplyEmailFallback({
        orgId: claimed.org_id,
        interviewId: interview.id,
        conversationId: conversation.id,
        candidateId: candidate.id,
        candidateName: candidate.name,
        candidateEmail: candidate.email,
        companyName: organization.name,
        roleTitle: interview.role_title || "Interview",
      });
      if (!result.ok) throw new Error(result.error);
      return true;
    } catch (followupError) {
      await admin.from("interviews").update({ followup_email_claimed_at: null }).eq("id", claimed.interview_id).eq("org_id", claimed.org_id);
      await recordOperationalEvent({
        severity: "error",
        source: "cron",
        eventType: "no_reply_fallback_failed",
        orgId: claimed.org_id,
        interviewId: claimed.interview_id,
        message: safeErrorMessage(followupError, "No-reply fallback failed"),
      });
      return false;
    }
  }));

  const sent = results.filter(Boolean).length;
  return { claimed: due?.length ?? 0, sent, failed: results.length - sent };
}

async function processReminders(kind: "24h" | "1h") {
  const admin = createAdminClient();
  const { data: due, error } = await admin.rpc("claim_due_interview_reminders", { p_kind: kind, p_limit: 10 });
  if (error) throw new Error(error.message);

  const results = await Promise.all((due ?? []).map(async (claimed: { org_id: string; interview_id: number }) => {
    try {
      await sendDueInterviewReminder({ orgId: claimed.org_id, interviewId: claimed.interview_id, kind });
      return true;
    } catch (reminderError) {
      const reset = kind === "24h" ? { reminder_24h_sent_at: null } : { reminder_1h_sent_at: null };
      await admin.from("interviews").update(reset).eq("id", claimed.interview_id).eq("org_id", claimed.org_id);
      await recordOperationalEvent({
        severity: "error",
        source: "cron",
        eventType: `reminder_${kind}_failed`,
        orgId: claimed.org_id,
        interviewId: claimed.interview_id,
        message: safeErrorMessage(reminderError, "Interview reminder failed"),
      });
      return false;
    }
  }));

  const sent = results.filter(Boolean).length;
  return { kind, claimed: due?.length ?? 0, sent, failed: results.length - sent };
}

async function pruneOperationalData() {
  try {
    const admin = createAdminClient();
    await admin.rpc("prune_schela_operational_data");
  } catch (error) {
    await recordOperationalEvent({
      severity: "warning",
      source: "cron",
      eventType: "operational_prune_failed",
      message: safeErrorMessage(error, "Operational data cleanup failed"),
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) return new NextResponse("Unauthorized", { status: 401, headers: noStoreHeaders() });

    const [followups, reminders24h, reminders1h] = await Promise.all([
      processNoReplyFallbacks(),
      processReminders("24h"),
      processReminders("1h"),
    ]);
    await pruneOperationalData();

    const failed = followups.failed + reminders24h.failed + reminders1h.failed;
    return NextResponse.json({
      ok: failed === 0,
      followups,
      reminders: { h24: reminders24h, h1: reminders1h },
    }, { headers: noStoreHeaders() });
  } catch (error) {
    await recordOperationalEvent({
      severity: "error",
      source: "cron",
      eventType: "run_failed",
      message: safeErrorMessage(error, "Cron processing failed"),
    });
    return NextResponse.json({ ok: false, error: "Cron processing failed" }, { status: 500, headers: noStoreHeaders() });
  }
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST for scheduled execution" },
    { status: 405, headers: noStoreHeaders({ Allow: "POST" }) },
  );
}
