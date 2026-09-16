import "server-only";

export type WhatsAppWebhookConfig = {
  phoneNumberId: string;
  verifyToken: string;
  appSecret: string;
};

const DEFAULT_API_VERSION = "v23.0";
const DEFAULT_INITIAL_TEMPLATE_NAME = "schela_interview_invite_v1";
const DEFAULT_INITIAL_TEMPLATE_LANGUAGE = "en_US";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function getWhatsAppWebhookConfig(): WhatsAppWebhookConfig {
  return {
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    verifyToken: required("WHATSAPP_WEBHOOK_VERIFY_TOKEN"),
    appSecret: required("WHATSAPP_APP_SECRET"),
  };
}

export function getWhatsAppSendConfig() {
  return {
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    apiVersion: DEFAULT_API_VERSION,
    initialTemplateName: DEFAULT_INITIAL_TEMPLATE_NAME,
    initialTemplateLanguage: DEFAULT_INITIAL_TEMPLATE_LANGUAGE,
  };
}
