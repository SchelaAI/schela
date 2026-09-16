import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

export class RequestTooLargeError extends Error {
  constructor() {
    super("Request body is too large");
    this.name = "RequestTooLargeError";
  }
}

export async function readRawBody(request: NextRequest, maxBytes = 1024 * 1024) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new RequestTooLargeError();

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new RequestTooLargeError();
  return new TextDecoder().decode(bytes);
}

export function safeSecretEquals(received: string | null, expected: string) {
  if (!received) return false;
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function noStoreHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Pragma", "no-cache");
  return headers;
}
