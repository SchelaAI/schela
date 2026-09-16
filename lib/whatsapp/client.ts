import "server-only";

import { getWhatsAppSendConfig } from "./config";

export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly providerBody: unknown,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

type SendResult = {
  messageId: string;
  raw: unknown;
};

async function graphPost(body: Record<string, unknown>): Promise<SendResult> {
  const { phoneNumberId, accessToken, apiVersion } = getWhatsAppSendConfig();
  const response = await fetch(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );

  const raw = await response.json().catch(() => null);
  if (!response.ok) {
    const providerMessage =
      raw && typeof raw === "object" && "error" in raw
        ? JSON.stringify((raw as { error?: unknown }).error)
        : `HTTP ${response.status}`;
    throw new WhatsAppApiError(
      `WhatsApp send failed: ${providerMessage}`,
      response.status,
      raw,
    );
  }

  const messageId =
    raw &&
    typeof raw === "object" &&
    "messages" in raw &&
    Array.isArray((raw as { messages?: unknown[] }).messages)
      ? ((raw as { messages: Array<{ id?: string }> }).messages[0]?.id ?? "")
      : "";

  if (!messageId) {
    throw new WhatsAppApiError(
      "WhatsApp accepted the request but returned no message id",
      response.status,
      raw,
    );
  }

  return { messageId, raw };
}

export async function sendWhatsAppInterviewTemplate(input: {
  to: string;
  candidateName: string;
  companyName: string;
  roleTitle: string;
}) {
  const { initialTemplateName, initialTemplateLanguage } = getWhatsAppSendConfig();

  // Contract for the approved template `schela_interview_invite_v1`:
  // {{1}} candidate name, {{2}} hiring company, {{3}} role title.
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "template",
    template: {
      name: initialTemplateName,
      language: { code: initialTemplateLanguage },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: input.candidateName },
            { type: "text", text: input.companyName },
            { type: "text", text: input.roleTitle },
          ],
        },
      ],
    },
  });
}

export async function sendWhatsAppText(input: { to: string; text: string }) {
  return graphPost({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: input.to,
    type: "text",
    text: { preview_url: false, body: input.text },
  });
}
