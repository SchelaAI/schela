import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
) {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = `sha256=${createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")}`;

  const receivedBuffer = Buffer.from(signatureHeader, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
