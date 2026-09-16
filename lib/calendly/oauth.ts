import "server-only";

import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCalendlyConfig } from "./config";

const AUTH_BASE = "https://auth.calendly.com";

export function createPkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOAuthState() {
  return randomBytes(32).toString("base64url");
}

function basicAuth() {
  const { clientId, clientSecret } = getCalendlyConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function tokenRequest(body: URLSearchParams) {
  const response = await fetch(`${AUTH_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Calendly OAuth token request failed (${response.status}): ${JSON.stringify(json).slice(0, 1200)}`);
  }

  return json as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    owner: string;
    organization: string;
    scope?: string;
  };
}

export async function exchangeAuthorizationCode(input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  return tokenRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  }));
}

async function refreshTokens(orgId: string, refreshToken: string) {
  const json = await tokenRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }));

  const admin = createAdminClient();
  const expiresAt = new Date(Date.now() + Math.max(60, json.expires_in - 30) * 1000).toISOString();
  const { error } = await admin
    .from("calendly_connections")
    .update({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      access_token_expires_at: expiresAt,
      owner_uri: json.owner,
      organization_uri: json.organization,
      refresh_claimed_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);

  if (error) throw new Error(`Could not persist rotated Calendly token: ${error.message}`);
  return json.access_token;
}

export async function getCalendlyAccessToken(orgId: string) {
  const admin = createAdminClient();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: connection, error } = await admin
      .from("calendly_connections")
      .select("access_token,access_token_expires_at")
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) throw new Error(`Could not load Calendly connection: ${error.message}`);
    if (!connection) throw new Error("Calendly is not connected for this workspace");

    const expiresAt = new Date(connection.access_token_expires_at).getTime();
    if (expiresAt > Date.now() + 5 * 60 * 1000) return connection.access_token as string;

    const { data: claimedRefreshToken, error: claimError } = await admin.rpc("claim_calendly_token_refresh", {
      p_org_id: orgId,
    });
    if (claimError) throw new Error(`Could not claim Calendly token refresh: ${claimError.message}`);

    if (claimedRefreshToken) {
      try {
        return await refreshTokens(orgId, claimedRefreshToken as string);
      } catch (error) {
        await admin
          .from("calendly_connections")
          .update({ refresh_claimed_until: null, updated_at: new Date().toISOString() })
          .eq("org_id", orgId);
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 350 + attempt * 150));
  }

  throw new Error("Calendly token refresh is busy; retry shortly");
}
