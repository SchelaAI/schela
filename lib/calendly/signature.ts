import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

export function verifyCalendlySignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  signingKey: string;
  toleranceSeconds?: number;
}) {
  if (!input.signatureHeader) return false;
  const parts = Object.fromEntries(
    input.signatureHeader.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > (input.toleranceSeconds ?? 180)) return false;

  const expected = createHmac("sha256", input.signingKey)
    .update(`${timestamp}.${input.rawBody}`)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
