import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getEmailConfig } from "@/lib/email/config";
import { processInboundResendEmail, processResendDeliveryEvent } from "@/lib/email/webhook";
import { claimWebhookEvent, releaseWebhookEvent } from "@/lib/webhooks/ledger";
import { readRawBody, RequestTooLargeError, noStoreHeaders } from "@/lib/http/security";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let rawBody: string;
  try {
    rawBody = await readRawBody(request, 1024 * 1024);
  } catch (error) {
    if (error instanceof RequestTooLargeError) return new NextResponse("Payload too large", { status: 413, headers: noStoreHeaders() });
    return new NextResponse("Invalid request", { status: 400, headers: noStoreHeaders() });
  }

  const config = getEmailConfig();
  const resend = new Resend(config.apiKey);
  const eventId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");

  if (!eventId || !timestamp || !signature) {
    return new NextResponse("Missing webhook signature", { status: 400, headers: noStoreHeaders() });
  }

  let verifiedEvent: unknown;
  try {
    verifiedEvent = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: eventId, timestamp, signature },
      webhookSecret: config.webhookSecret,
    });
  } catch {
    return new NextResponse("Invalid webhook signature", { status: 401, headers: noStoreHeaders() });
  }

  if (
    typeof verifiedEvent !== "object" ||
    verifiedEvent === null ||
    !("type" in verifiedEvent) ||
    typeof verifiedEvent.type !== "string" ||
    !("data" in verifiedEvent) ||
    typeof verifiedEvent.data !== "object" ||
    verifiedEvent.data === null
  ) {
    return new NextResponse("Invalid webhook payload", { status: 400, headers: noStoreHeaders() });
  }

  const event = verifiedEvent as {
    type: string;
    created_at?: string;
    data: Record<string, unknown>;
  };

  const claimed = await claimWebhookEvent({ provider: "resend", eventId, eventType: event.type });
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true }, { headers: noStoreHeaders() });

  try {
    if (event.type === "email.received") {
      await processInboundResendEmail(event as unknown as Parameters<typeof processInboundResendEmail>[0]);
    } else if (event.type.startsWith("email.")) {
      await processResendDeliveryEvent(event as unknown as Parameters<typeof processResendDeliveryEvent>[0]);
    }
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    await releaseWebhookEvent("resend", eventId);
    await recordOperationalEvent({
      severity: "error",
      source: "resend_webhook",
      eventType: event.type,
      message: safeErrorMessage(error, "Resend webhook processing failed"),
      metadata: { eventId },
    });
    return new NextResponse("Webhook processing failed", { status: 500, headers: noStoreHeaders() });
  }
}
