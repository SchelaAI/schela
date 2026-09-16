import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCalendlyConfig } from "@/lib/calendly/config";
import { verifyCalendlySignature } from "@/lib/calendly/signature";
import { claimWebhookEvent, releaseWebhookEvent } from "@/lib/webhooks/ledger";
import { handleCalendlyInviteeCanceled, handleCalendlyInviteeCreated } from "@/lib/calendly/workflow";
import { readRawBody, RequestTooLargeError, noStoreHeaders } from "@/lib/http/security";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CalendlyWebhook = {
  event?: string;
  created_at?: string;
  payload?: {
    uri?: string;
    email?: string;
    event?: string;
    cancel_url?: string;
    reschedule_url?: string;
    rescheduled?: boolean;
    old_invitee?: string | null;
    new_invitee?: string | null;
    tracking?: { utm_content?: string | null } | null;
    cancellation?: { reason?: string | null; canceled_by?: string | null } | null;
  };
};

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readRawBody(request, 512 * 1024);
  } catch (error) {
    if (error instanceof RequestTooLargeError) return new NextResponse("Payload too large", { status: 413, headers: noStoreHeaders() });
    return new NextResponse("Invalid request", { status: 400, headers: noStoreHeaders() });
  }

  const signature = request.headers.get("calendly-webhook-signature");
  const { webhookSigningKey } = getCalendlyConfig();
  if (!verifyCalendlySignature({ rawBody, signatureHeader: signature, signingKey: webhookSigningKey, toleranceSeconds: 180 })) {
    return new NextResponse("Invalid signature", { status: 401, headers: noStoreHeaders() });
  }

  let payload: CalendlyWebhook;
  try {
    payload = JSON.parse(rawBody) as CalendlyWebhook;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400, headers: noStoreHeaders() });
  }

  const eventType = payload.event || "unknown";
  const eventId = createHash("sha256").update(rawBody).digest("hex");
  const claimed = await claimWebhookEvent({ provider: "calendly", eventId, eventType });
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true }, { headers: noStoreHeaders() });

  try {
    const routeToken = payload.payload?.tracking?.utm_content ?? null;
    if (eventType === "invitee.created") {
      await handleCalendlyInviteeCreated({
        routeToken,
        inviteeUri: payload.payload?.uri ?? null,
        oldInviteeUri: payload.payload?.old_invitee ?? null,
        eventUri: payload.payload?.event ?? null,
        inviteeEmail: payload.payload?.email ?? null,
        cancelUrl: payload.payload?.cancel_url ?? null,
        rescheduleUrl: payload.payload?.reschedule_url ?? null,
        rescheduled: payload.payload?.rescheduled ?? false,
      });
    } else if (eventType === "invitee.canceled") {
      await handleCalendlyInviteeCanceled({
        routeToken,
        inviteeUri: payload.payload?.uri ?? null,
        oldInviteeUri: payload.payload?.old_invitee ?? null,
        eventUri: payload.payload?.event ?? null,
        inviteeEmail: payload.payload?.email ?? null,
        rescheduled: payload.payload?.rescheduled ?? false,
        cancellationReason: payload.payload?.cancellation?.reason ?? null,
      });
    }
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    await releaseWebhookEvent("calendly", eventId);
    await recordOperationalEvent({
      severity: "error",
      source: "calendly_webhook",
      eventType,
      message: safeErrorMessage(error, "Calendly webhook processing failed"),
      metadata: { eventId },
    });
    return NextResponse.json({ ok: false }, { status: 500, headers: noStoreHeaders() });
  }
}
