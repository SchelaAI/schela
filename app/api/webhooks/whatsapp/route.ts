import { NextRequest, NextResponse } from "next/server";
import { getWhatsAppWebhookConfig } from "@/lib/whatsapp/config";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/signature";
import type { WhatsAppWebhookPayload } from "@/lib/whatsapp/types";
import { processInboundWhatsAppMessage, processWhatsAppStatus } from "@/lib/whatsapp/webhook";
import { orchestrateCandidateMessage } from "@/lib/ai/orchestrator";
import { readRawBody, RequestTooLargeError, noStoreHeaders, safeSecretEquals } from "@/lib/http/security";
import { recordOperationalEvent, safeErrorMessage } from "@/lib/observability/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { verifyToken } = getWhatsAppWebhookConfig();
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && safeSecretEquals(token, verifyToken) && challenge && challenge.length <= 512) {
    return new NextResponse(challenge, { status: 200, headers: noStoreHeaders({ "Content-Type": "text/plain; charset=utf-8" }) });
  }
  return new NextResponse("Forbidden", { status: 403, headers: noStoreHeaders() });
}

export async function POST(request: NextRequest) {
  const config = getWhatsAppWebhookConfig();
  let rawBody: string;
  try {
    rawBody = await readRawBody(request, 1024 * 1024);
  } catch (error) {
    if (error instanceof RequestTooLargeError) return new NextResponse("Payload too large", { status: 413, headers: noStoreHeaders() });
    return new NextResponse("Invalid request", { status: 400, headers: noStoreHeaders() });
  }

  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyMetaWebhookSignature(rawBody, signature, config.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401, headers: noStoreHeaders() });
  }

  let payload: WhatsAppWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WhatsAppWebhookPayload;
  } catch {
    return new NextResponse("Invalid JSON", { status: 400, headers: noStoreHeaders() });
  }

  if (payload.object !== "whatsapp_business_account") {
    return NextResponse.json({ ok: true, ignored: true }, { headers: noStoreHeaders() });
  }

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value;
        const senderPhoneNumberId = value?.metadata?.phone_number_id;
        if (!value || !senderPhoneNumberId || senderPhoneNumberId !== config.phoneNumberId) continue;

        for (const status of value.statuses ?? []) {
          await processWhatsAppStatus(status, value);
        }

        for (const message of value.messages ?? []) {
          const contactName = value.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name;
          const inbound = await processInboundWhatsAppMessage({ senderPhoneNumberId, message, payload: value, contactName });
          if (inbound) {
            await orchestrateCandidateMessage({
              inboundMessageId: inbound.inboundMessageId,
              orgId: inbound.orgId,
              conversationId: inbound.conversationId,
              channel: "wa",
              candidateWaId: inbound.candidateWaId,
            });
          }
        }
      }
    }
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    await recordOperationalEvent({
      severity: "error",
      source: "whatsapp_webhook",
      eventType: "processing_failed",
      message: safeErrorMessage(error, "WhatsApp webhook processing failed"),
    });
    // Meta retries non-2xx responses, and provider-event/message idempotency
    // prevents duplicates during a retry.
    return new NextResponse("Webhook processing failed", { status: 500, headers: noStoreHeaders() });
  }
}
