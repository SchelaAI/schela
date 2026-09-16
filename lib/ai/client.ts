import "server-only";

import Groq from "groq-sdk";
import { schelaDecisionSchema, type SchelaDecision } from "./decision";

const DEFAULT_MODEL = "openai/gpt-oss-20b";
const MAX_HISTORY_MESSAGE_CHARS = 4_000;
const MAX_HISTORY_TOTAL_CHARS = 32_000;

const decisionJsonSchema = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "greeting", "availability", "scheduling", "reschedule", "cancel",
        "confirmation", "logistics_question", "hiring_question", "compensation",
        "visa", "withdraw", "other",
      ],
    },
    action: { type: "string", enum: ["reply", "needs_calendar", "escalate", "close"] },
    reply: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    audit_rationale: { type: "string" },
    ambiguities: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["intent", "action", "reply", "confidence", "audit_rationale", "ambiguities"],
  additionalProperties: false,
} as const;

function compactHistory(
  history: Array<{ fromRole: "schela" | "candidate" | "system"; text: string; channel: string | null }>,
) {
  let remaining = MAX_HISTORY_TOTAL_CHARS;
  const compacted: typeof history = [];

  for (const message of [...history].reverse()) {
    if (remaining <= 0) break;
    const normalized = message.text.replace(/\s+/g, " ").trim();
    const text = normalized.slice(0, Math.min(MAX_HISTORY_MESSAGE_CHARS, remaining));
    remaining -= text.length;
    compacted.push({ ...message, text });
  }

  return compacted.reverse();
}

function getGroq() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured");
  return new Groq({ apiKey, timeout: 10_000, maxRetries: 0 });
}

export async function makeSchelaDecision(input: {
  companyName: string;
  candidateName: string;
  roleTitle: string;
  interviewerName: string;
  durationMinutes: number;
  scheduledAt: string | null;
  channel: "wa" | "em";
  history: Array<{ fromRole: "schela" | "candidate" | "system"; text: string; channel: string | null }>;
}) {
  const groq = getGroq();
  const model = DEFAULT_MODEL;

  const system = `You are Schela, an AI interview scheduling assistant for ${input.companyName}.
Your job is ONLY interview coordination and scheduling logistics.

Rules:
- Write naturally, warmly, and briefly. Never claim to be a human. You may simply speak as Schela.
- Never evaluate a candidate, predict hiring outcomes, rank them, discuss protected traits, or make employment decisions.
- Never invent calendar availability, meeting links, compensation, visa policy, company policy, or facts not provided in context.
- If the candidate gives availability or asks to book/reschedule, set action to "needs_calendar". Schela will provide a real Calendly booking/reschedule link; never invent a slot.
- Compensation, visa/immigration, hiring status/outcome, eligibility, sensitive policy questions, and unclear high-impact requests must use action "escalate".
- Cancellation or withdrawal should use action "close". Schela may safely cancel the connected Calendly event when confidence is high.
- Ordinary greetings and scheduling/logistics questions that can be answered from context can use action "reply".
- Keep reply under about 90 words unless the candidate clearly needs more.
- audit_rationale must be a short one-sentence operational explanation, not hidden chain-of-thought.
- Return JSON only.`;

  const recentHistory = compactHistory(input.history);

  const context = {
    candidate: input.candidateName,
    role: input.roleTitle,
    interviewer: input.interviewerName,
    duration_minutes: input.durationMinutes,
    scheduled_at: input.scheduledAt,
    inbound_channel: input.channel,
    recent_conversation: recentHistory.map((message) => ({
      speaker: message.fromRole,
      channel: message.channel,
      text: message.text,
    })),
    required_json_shape: {
      intent: "greeting|availability|scheduling|reschedule|cancel|confirmation|logistics_question|hiring_question|compensation|visa|withdraw|other",
      action: "reply|needs_calendar|escalate|close",
      reply: "candidate-facing response",
      confidence: "number 0 to 1",
      audit_rationale: "brief operational rationale",
      ambiguities: ["zero or more short ambiguity notes"],
    },
  };

  const completion = await groq.chat.completions.create({
    model,
    temperature: 0.2,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "schela_decision",
        strict: true,
        schema: decisionJsonSchema,
      },
    },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(context) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Groq returned an empty Schela decision");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("Groq returned invalid JSON");
  }

  const parsed = schelaDecisionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Groq decision failed validation: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }

  if (parsed.data.action === "reply" && /\b(?:https?:\/\/|www\.)/i.test(parsed.data.reply)) {
    throw new Error("Groq returned an untrusted external URL in a direct reply");
  }

  return {
    decision: parsed.data as SchelaDecision,
    model,
    inputTokens: completion.usage?.prompt_tokens ?? null,
    outputTokens: completion.usage?.completion_tokens ?? null,
  };
}
