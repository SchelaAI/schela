import "server-only";

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCalendlyAccessToken } from "./oauth";

const API_BASE = "https://api.calendly.com";

async function calendlyFetch<T>(orgId: string, pathOrUrl: string, init?: RequestInit): Promise<T> {
  const token = await getCalendlyAccessToken(orgId);
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`Calendly API failed (${response.status}): ${JSON.stringify(json).slice(0, 1500)}`) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return json as T;
}

export type CalendlyEventType = {
  uri: string;
  name: string;
  active: boolean;
  scheduling_url?: string;
  profile?: { name?: string; owner?: string; type?: string };
};

export async function getCalendlyConnection(orgId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendly_connections")
    .select("org_id,owner_uri,organization_uri,account_name,account_email,webhook_subscription_uri,webhook_scope,default_event_type_uri,default_event_type_name,connected_at,updated_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function listCalendlyEventTypes(orgId: string) {
  const connection = await getCalendlyConnection(orgId);
  if (!connection) return [] as CalendlyEventType[];

  const organizationQuery = `/event_types?organization=${encodeURIComponent(connection.organization_uri)}&active=true&count=100&sort=name:asc`;
  try {
    const result = await calendlyFetch<{ collection: CalendlyEventType[] }>(orgId, organizationQuery);
    return result.collection ?? [];
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status !== 403) throw error;
    const result = await calendlyFetch<{ collection: CalendlyEventType[] }>(
      orgId,
      `/event_types?user=${encodeURIComponent(connection.owner_uri)}&active=true&count=100&sort=name:asc`,
    );
    return result.collection ?? [];
  }
}

export async function getCalendlyUser(orgId: string, ownerUri: string) {
  return calendlyFetch<{ resource: { name?: string; email?: string; uri?: string } }>(orgId, ownerUri);
}

export async function createCalendlyWebhookSubscription(input: {
  orgId: string;
  callbackUrl: string;
}) {
  const connection = await getCalendlyConnection(input.orgId);
  if (!connection) throw new Error("Calendly connection missing");

  const base = {
    url: input.callbackUrl,
    events: ["invitee.created", "invitee.canceled"],
    organization: connection.organization_uri,
  };

  try {
    const result = await calendlyFetch<{ resource: { uri: string; scope: "organization" | "user" } }>(input.orgId, "/webhook_subscriptions", {
      method: "POST",
      body: JSON.stringify({ ...base, scope: "organization" }),
    });
    return result.resource;
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status !== 403) throw error;
    const result = await calendlyFetch<{ resource: { uri: string; scope: "organization" | "user" } }>(input.orgId, "/webhook_subscriptions", {
      method: "POST",
      body: JSON.stringify({ ...base, scope: "user", user: connection.owner_uri }),
    });
    return result.resource;
  }
}

export async function deleteCalendlyWebhookSubscription(orgId: string, uri: string) {
  const uuid = uri.split("/").filter(Boolean).at(-1);
  if (!uuid) return;
  const token = await getCalendlyAccessToken(orgId);
  const response = await fetch(`${API_BASE}/webhook_subscriptions/${encodeURIComponent(uuid)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 404) {
    const body = await response.text();
    throw new Error(`Could not delete Calendly webhook (${response.status}): ${body.slice(0, 1000)}`);
  }
}

async function resolveEventTypeUri(input: { orgId: string; interviewId: number }) {
  const admin = createAdminClient();
  const { data: interview } = await admin
    .from("interviews")
    .select("calendly_event_type_uri,interviewer_id")
    .eq("id", input.interviewId)
    .eq("org_id", input.orgId)
    .single();

  if (interview?.calendly_event_type_uri) return interview.calendly_event_type_uri as string;

  if (interview?.interviewer_id) {
    const { data: interviewer } = await admin
      .from("interviewers")
      .select("calendly_event_type_uri")
      .eq("id", interview.interviewer_id)
      .eq("org_id", input.orgId)
      .maybeSingle();
    if (interviewer?.calendly_event_type_uri) return interviewer.calendly_event_type_uri as string;
  }

  const { data: connection } = await admin
    .from("calendly_connections")
    .select("default_event_type_uri")
    .eq("org_id", input.orgId)
    .maybeSingle();

  if (!connection?.default_event_type_uri) {
    throw new Error("No Calendly event type is configured for this interviewer or workspace");
  }
  return connection.default_event_type_uri as string;
}

export async function createInterviewSchedulingLink(input: {
  orgId: string;
  interviewId: number;
  conversationId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
}) {
  const admin = createAdminClient();
  const eventTypeUri = await resolveEventTypeUri(input);
  const result = await calendlyFetch<{ resource: { booking_url: string; owner: string } }>(input.orgId, "/scheduling_links", {
    method: "POST",
    body: JSON.stringify({
      max_event_count: 1,
      owner: eventTypeUri,
      owner_type: "EventType",
    }),
  });

  const routeToken = randomBytes(24).toString("base64url");
  const url = new URL(result.resource.booking_url);
  url.searchParams.set("utm_source", "schela");
  url.searchParams.set("utm_medium", "assistant");
  url.searchParams.set("utm_campaign", "interview_scheduling");
  url.searchParams.set("utm_content", routeToken);
  url.searchParams.set("name", input.candidateName);
  url.searchParams.set("email", input.candidateEmail);
  const bookingUrl = url.toString();

  const { error } = await admin.from("calendly_booking_routes").insert({
    route_token: routeToken,
    org_id: input.orgId,
    interview_id: input.interviewId,
    candidate_id: input.candidateId,
    conversation_id: input.conversationId,
    event_type_uri: eventTypeUri,
    booking_url: bookingUrl,
  });
  if (error) throw new Error(`Could not persist Calendly booking route: ${error.message}`);

  await admin
    .from("interviews")
    .update({
      calendly_event_type_uri: eventTypeUri,
      calendly_booking_link_sent_at: new Date().toISOString(),
      ai_state: "scheduling",
    })
    .eq("id", input.interviewId)
    .eq("org_id", input.orgId);

  return { bookingUrl, routeToken, eventTypeUri };
}

export async function getCalendlyScheduledEvent(orgId: string, eventUri: string) {
  return calendlyFetch<{ resource: {
    uri: string;
    start_time: string;
    end_time?: string;
    status?: string;
    event_type?: string;
    location?: { join_url?: string; location?: string; type?: string } | null;
  } }>(orgId, eventUri);
}

export async function cancelCalendlyInterview(input: { orgId: string; eventUri: string; reason?: string }) {
  const uuid = input.eventUri.split("/").filter(Boolean).at(-1);
  if (!uuid) throw new Error("Calendly event URI is invalid");
  return calendlyFetch(input.orgId, `/scheduled_events/${encodeURIComponent(uuid)}/cancellation`, {
    method: "POST",
    body: JSON.stringify({ reason: input.reason || "Candidate requested cancellation through Schela." }),
  });
}
