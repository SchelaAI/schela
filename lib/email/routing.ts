import "server-only";

import { randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEmailConfig } from "./config";

export function normalizeEmailAddress(value: string | null | undefined) {
  if (!value) return "";
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export async function ensureEmailRoute(input: {
  orgId: string;
  candidateId: string;
  conversationId: string;
  interviewId: number;
}) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("email_thread_routes")
    .select("inbound_address,route_token")
    .eq("org_id", input.orgId)
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  if (existing) return existing;

  const { inboundDomain } = getEmailConfig();
  const routeToken = randomBytes(18).toString("hex");
  const inboundAddress = `schela-${routeToken}@${inboundDomain}`;

  const { data, error } = await admin
    .from("email_thread_routes")
    .insert({
      route_token: routeToken,
      inbound_address: inboundAddress,
      org_id: input.orgId,
      candidate_id: input.candidateId,
      conversation_id: input.conversationId,
      interview_id: input.interviewId,
    })
    .select("inbound_address,route_token")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create inbound email route");
  }

  return data;
}
