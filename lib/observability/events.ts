import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

type Severity = "info" | "warning" | "error";

function cleanText(value: unknown, max = 1200) {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(access_token|refresh_token|client_secret|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]")
    .slice(0, max);
}

export async function recordOperationalEvent(input: {
  severity: Severity;
  source: string;
  eventType: string;
  message: string;
  orgId?: string | null;
  conversationId?: string | null;
  interviewId?: number | null;
  metadata?: Record<string, unknown> | null;
}) {
  try {
    const admin = createAdminClient();
    const sanitizedMetadata = input.metadata
      ? Object.fromEntries(
          Object.entries(input.metadata).map(([key, value]) => [
            key,
            typeof value === "string" ? cleanText(value, 500) : value,
          ]),
        )
      : null;

    await admin.from("operational_events").insert({
      severity: input.severity,
      source: input.source.slice(0, 100),
      event_type: input.eventType.slice(0, 120),
      org_id: input.orgId ?? null,
      conversation_id: input.conversationId ?? null,
      interview_id: input.interviewId ?? null,
      message: cleanText(input.message, 1200) || "Operational event",
      metadata: sanitizedMetadata,
    });
  } catch {
    // Observability must never become a second failure path.
  }
}

export function safeErrorMessage(error: unknown, fallback = "Something went wrong") {
  if (error instanceof Error) return cleanText(error.message, 800) || fallback;
  return fallback;
}
