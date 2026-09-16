import { headers } from "next/headers";

export async function getRequestOrigin() {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:" || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
        return parsed.origin;
      }
    } catch {
      // Fall through to proxy headers.
    }
  }

  const proto = requestHeaders.get("x-forwarded-proto") === "https" ? "https" : "http";
  const rawHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const host = rawHost.split(",")[0].trim();
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$/i.test(host)) return "http://localhost:3000";
  return `${proto}://${host}`;
}
