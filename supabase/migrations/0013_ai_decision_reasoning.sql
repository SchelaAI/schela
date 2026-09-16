-- ============================================================================
-- Schela — persist the AI's own reasoning in the audit trail
-- Run after 0012_fix_check_constraints.sql.
--
-- The classifier now produces an explicit "reasoning" field (its working-out,
-- generated BEFORE it commits to an intent) plus any ambiguities it flagged,
-- and the orchestrator produces a plain-language escalation reason. All three
-- were being computed and then discarded, which defeats the point of having
-- an ai_decisions audit table: a recruiter asking "why did Schela do that?"
-- could see the label and confidence but not the thinking behind them.
-- ============================================================================

alter table ai_decisions
  add column if not exists reasoning text,
  add column if not exists ambiguities text[],
  add column if not exists escalation_reason text;

-- The escalation reason is also stored on the conversation itself so the
-- Escalation modal can show WHY without joining back to ai_decisions. The
-- modal previously hardcoded "confidence below threshold" for every
-- escalation, which is now wrong in three of the four cases (sensitive
-- topic, flagged ambiguity, AI unavailable).
alter table conversations
  add column if not exists escalation_reason text;
