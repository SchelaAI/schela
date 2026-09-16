import { z } from "zod";

export const schelaDecisionSchema = z.object({
  intent: z.enum([
    "greeting",
    "availability",
    "scheduling",
    "reschedule",
    "cancel",
    "confirmation",
    "logistics_question",
    "hiring_question",
    "compensation",
    "visa",
    "withdraw",
    "other",
  ]),
  action: z.enum(["reply", "needs_calendar", "escalate", "close"]),
  reply: z.string().min(1).max(1800),
  confidence: z.number().min(0).max(1),
  audit_rationale: z.string().min(1).max(500),
  ambiguities: z.array(z.string().max(250)).max(5),
});

export type SchelaDecision = z.infer<typeof schelaDecisionSchema>;
