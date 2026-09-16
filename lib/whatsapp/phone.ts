export function normalizeWhatsAppNumber(...parts: Array<string | null | undefined>) {
  return parts.join("").replace(/\D/g, "");
}
