import "server-only";

export function getCalendlyConfig() {
  const clientId = process.env.CALENDLY_CLIENT_ID?.trim();
  const clientSecret = process.env.CALENDLY_CLIENT_SECRET?.trim();
  const webhookSigningKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY?.trim();

  if (!clientId || !clientSecret || !webhookSigningKey) {
    throw new Error("Missing Calendly environment variables");
  }

  return { clientId, clientSecret, webhookSigningKey };
}

export const CALENDLY_SCOPES = [
  "event_types:read",
  "scheduled_events:write",
  "scheduling_links:write",
  "webhooks:write",
  "webhooks:read",
].join(" ");
