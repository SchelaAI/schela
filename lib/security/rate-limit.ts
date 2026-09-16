import "server-only";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function requestFingerprint() {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || requestHeaders.get("x-real-ip")?.trim() || "unknown";
  const agent = requestHeaders.get("user-agent")?.slice(0, 160) || "unknown";
  return digest(`${ip}|${agent}`);
}

export async function consumeRateLimit(input: {
  scope: string;
  identifier?: string | null;
  limit: number;
  windowSeconds: number;
}) {
  const fingerprint = await requestFingerprint();
  const key = digest(`${input.scope}|${fingerprint}|${(input.identifier || "").toLowerCase()}`);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_rate_key: key,
    p_scope: input.scope,
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: Boolean(row?.allowed),
    remaining: Number(row?.remaining ?? 0),
    retryAfterSeconds: Number(row?.retry_after_seconds ?? input.windowSeconds),
  };
}
