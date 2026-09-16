import "server-only";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function getEmailConfig() {
  const apiKey = required("RESEND_API_KEY");
  const webhookSecret = required("RESEND_WEBHOOK_SECRET");
  const fromAddress = required("EMAIL_FROM_ADDRESS");
  const replyTo = required("EMAIL_REPLY_TO");

  const at = replyTo.lastIndexOf("@");
  if (at <= 0 || at === replyTo.length - 1) {
    throw new Error("EMAIL_REPLY_TO must be a valid receiving email address");
  }

  return {
    apiKey,
    webhookSecret,
    fromAddress,
    replyTo,
    inboundDomain: replyTo.slice(at + 1).toLowerCase(),
  };
}

export function getResendApiKey() {
  return required("RESEND_API_KEY");
}
