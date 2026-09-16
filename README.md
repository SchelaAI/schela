# Schela — Phase 6 Production Release Candidate

Schela is a Next.js 16 AI recruiting coordinator that keeps WhatsApp and email in one interview conversation, uses Groq to handle scheduling dialogue, and connects candidates to real Calendly booking flows.

This checkpoint completes the planned **Phase 6 production-hardening pass**. It intentionally uses **cron-job.org**, not Vercel Cron.

## End-to-end product flow

1. Recruiter signs up with Supabase Auth and completes onboarding.
2. Recruiter adds company interviewers and candidates.
3. Recruiter connects Calendly with OAuth + PKCE and selects a default or interviewer-specific event type.
4. Creating an interview sends approved WhatsApp template outreach or email outreach.
5. Candidate replies through WhatsApp or email.
6. Verified provider webhook stores the message in the unified Schela conversation.
7. Groq returns a strict structured scheduling decision.
8. Safe scheduling dialogue is answered automatically on the same channel; risky/ambiguous cases create recruiter action items.
9. Scheduling intent produces a trusted single-use Calendly link.
10. Calendly booking/reschedule/cancellation webhooks update the exact interview.
11. Schela sends confirmations and due reminders.
12. WhatsApp silence for 24 hours falls back to Resend email.
13. Email replies continue in the same interview conversation.
14. cron-job.org calls one protected POST endpoint for fallbacks, reminders, and operational retention.

## Phase 6 hardening

- Browser workflow access is read-only; mutations run through authenticated server actions or verified provider webhooks.
- RLS/grants are tightened and cross-tenant composite foreign-key relationships are enforced.
- `profiles.org_id` tenant-jump paths are closed.
- Private operational event logging with redacted errors.
- DB-backed rate limiting for sensitive actions.
- WhatsApp, Resend, and Calendly signature verification.
- Calendly timestamp replay protection.
- Webhook raw-body size limits and retry/idempotency handling.
- Provider/raw payloads are not duplicated into the generic webhook ledger.
- Strict Groq JSON-schema output + Zod validation.
- AI replies cannot directly ship model-generated external URLs.
- Provider calls have hard network timeouts.
- Cron side-effect endpoint is POST-only and Bearer protected.
- Failed reminder claims are released so later cron runs can retry.
- Cron work is limited to small concurrent batches for cron-job.org's execution window.
- CSP/HSTS/security headers are configured.
- Health endpoint reveals only service health, not internal details.
- Operational diagnostics/ledger data have pruning/retention rules.
- `server-only` boundaries protect backend integration modules.

## Canonical migrations

There are **26** canonical migrations:

```text
supabase/migrations/0001_init.sql
...
supabase/migrations/0026_production_hardening.sql
```

Do not use an older duplicate/combined migrations folder. `supabase/migrations/` is the source of truth.

## Environment variables

The original Schela environment contract is preserved. The only two additional required production secrets are `WHATSAPP_APP_SECRET` and `CRON_SECRET`.

```env
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

CALENDLY_CLIENT_ID=
CALENDLY_CLIENT_SECRET=
CALENDLY_WEBHOOK_SIGNING_KEY=

EMAIL_REPLY_TO=
RESEND_API_KEY=
EMAIL_FROM_ADDRESS=
RESEND_WEBHOOK_SECRET=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GROQ_API_KEY=

CRON_SECRET=
```

## cron-job.org

There is **no `vercel.json` and no Vercel Cron dependency**.

Configure one cron-job.org task:

```text
POST https://YOUR_DOMAIN/api/cron/followups
Authorization: Bearer YOUR_CRON_SECRET
Schedule: every 5 minutes
```

The endpoint processes:

- WhatsApp no-response ≥24h → email fallback
- due 24-hour interview reminders
- due 1-hour interview reminders
- operational data pruning

GET is intentionally rejected with HTTP 405.

## Release commands

```bash
npm install
npm run release:check
npm run typecheck
npm run build
```

`release:check` verifies the fixed env contract, 26 migrations, required routes, absence of Vercel Cron config, core security headers, Node 22+ requirement, cron POST protection, and obvious client-side provider-secret references.

## Production documentation

- `docs/PRODUCTION_SETUP_GUIDE.md` — zero-to-live provider and deployment configuration
- `docs/RELEASE_TEST_MATRIX.md` — P0/P1 test matrix and full end-to-end launch tests

## Release status

This repository is a **production release candidate**, not an unconditionally certified live deployment.

Source-level hardening and static checks can be performed here, but a production-ready declaration still requires all of the following in the target environment:

1. `npm install` succeeds.
2. `npm run release:check` succeeds.
3. `npm run typecheck` succeeds.
4. `npm run build` succeeds.
5. all 26 migrations apply cleanly to a fresh/test Supabase database.
6. every P0 test in `docs/RELEASE_TEST_MATRIX.md` passes against real Meta, Resend, Calendly, Groq, Supabase, and cron-job.org integrations.

Do not skip those checks before real candidate traffic.
