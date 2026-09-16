# Schela — Production Setup Guide

This is the zero-to-live setup guide for the Phase 6 release candidate.

> **Release rule:** do not send real candidate traffic until `npm run release:check`, `npm run typecheck`, `npm run build`, a clean database migration, and every **P0** item in `docs/RELEASE_TEST_MATRIX.md` passes against real provider test accounts.

## 1. What you need

- Node.js 22 or newer
- npm
- Git
- A Supabase project
- A Meta app with WhatsApp Cloud API + a WhatsApp Business Account/phone number
- A Resend account with a verified sending domain and an inbound receiving domain/address
- A Calendly developer OAuth application
- A Groq API key
- A cron-job.org account
- A public HTTPS deployment for Schela

There is **no Vercel Cron configuration** in Schela. You may deploy the Next.js application wherever you want; scheduled execution is handled by cron-job.org.

## 2. Install and verify the source tree

```bash
npm install
npm run release:check
npm run typecheck
npm run build
```

The project requires Node 22+.

If any of these commands fail, fix the failure before deploying. A successful static preflight is not a substitute for a successful Next.js production build.

## 3. Environment variables

Copy the example:

```bash
cp .env.example .env.local
```

The complete Schela environment contract is intentionally limited to these 16 values:

```env
# WhatsApp Cloud API
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_APP_SECRET=

# Calendly
CALENDLY_CLIENT_ID=
CALENDLY_CLIENT_SECRET=
CALENDLY_WEBHOOK_SIGNING_KEY=

# Resend / inbound email
EMAIL_REPLY_TO=
RESEND_API_KEY=
EMAIL_FROM_ADDRESS=
RESEND_WEBHOOK_SECRET=

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Schela AI
GROQ_API_KEY=

# cron-job.org protection
CRON_SECRET=
```

Your original environment names are preserved. `WHATSAPP_APP_SECRET` and `CRON_SECRET` are the only two additional production secrets.

Generate `WHATSAPP_WEBHOOK_VERIFY_TOKEN` and `CRON_SECRET` as long random values. Do not reuse passwords or provider secrets.

## 4. Supabase

### 4.1 Create the project

Create a production Supabase project and copy:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- Publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Secret key → `SUPABASE_SERVICE_ROLE_KEY`

The variable names intentionally remain compatible with the original Schela env contract even when your Supabase dashboard shows the newer **publishable/secret** terminology.

Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.

### 4.2 Apply migrations

There are 26 canonical migrations in `supabase/migrations`.

For a local clean-room test (Docker required):

```bash
npx supabase start
npx supabase db reset
```

For production:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

Do not manually cherry-pick migrations. Apply them in the numbered order from `0001` through `0026`.

### 4.3 Auth URLs

In Supabase Auth URL configuration:

- Site URL: `https://YOUR_DOMAIN`
- Redirect URL: `https://YOUR_DOMAIN/auth/callback`

If you also use a local environment, add:

- `http://localhost:3000/auth/callback`

The app exchanges Supabase's authorization code at `/auth/callback`. Existing users with a completed workspace continue to `/dashboard`; first-time users continue to `/onboarding`.

### 4.4 Google and LinkedIn sign-in

Schela supports both Google and LinkedIn through Supabase Auth. These provider credentials live in Supabase and do **not** add new Vercel environment variables.

In **Supabase → Authentication → Sign In / Providers**:

1. Enable **Google** and enter the Google OAuth client ID and secret.
2. Enable **LinkedIn (OIDC)** and enter the LinkedIn OIDC client ID and secret. Do not use the legacy LinkedIn provider.
3. Copy the Supabase provider callback URL shown in the dashboard. It has the form:

   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

4. Add that exact callback URL to the authorized redirect URLs in both the Google Cloud OAuth client and the LinkedIn Developer app.
5. For LinkedIn, request/enable the **Sign In with LinkedIn using OpenID Connect** product in the LinkedIn Developer dashboard.
6. Keep the Schela application redirect URL (`https://YOUR_DOMAIN/auth/callback`) in Supabase's redirect allow list as described above.

The application uses Supabase provider IDs `google` and `linkedin_oidc`.

### 4.5 RLS verification

Migration `0026_production_hardening.sql` intentionally makes authenticated browser access read-only for workflow state and moves mutations to authenticated server actions or verified provider webhooks.

Before launch, use a test project and verify:

- anonymous users cannot read candidate/interview/message data
- Tenant A cannot read Tenant B
- authenticated browser clients cannot directly insert/update/delete protected workflow rows
- `profiles.org_id` cannot be used to jump tenants
- server-side service-role operations still function

See the P0 database tests in `docs/RELEASE_TEST_MATRIX.md`.

## 5. Meta WhatsApp Cloud API

### 5.1 Required values

Set:

```env
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=YOUR_RANDOM_VERIFY_TOKEN
WHATSAPP_APP_SECRET=YOUR_META_APP_SECRET
```

`WHATSAPP_WEBHOOK_VERIFY_TOKEN` is the string you choose for Meta's webhook verification handshake.

`WHATSAPP_APP_SECRET` is different: it is the Meta App Secret Schela uses to validate the `x-hub-signature-256` on webhook POST requests.

### 5.2 Create the initial outreach template

Schela currently expects this exact template contract:

- Name: `schela_interview_invite_v1`
- Language: `en_US`
- Body:

```text
Hi {{1}}, I'm Schela, the scheduling assistant for {{2}}. I'm helping coordinate your interview for the {{3}} role. Reply here and I'll help you find a time that works.
```

Variables:

1. Candidate name
2. Organization/company name
3. Role title

Create and approve this template in WhatsApp Manager before testing interview creation.

### 5.3 Webhook

Configure your Meta webhook callback URL:

```text
https://YOUR_DOMAIN/api/webhooks/whatsapp
```

Use `WHATSAPP_WEBHOOK_VERIFY_TOKEN` as the verification token.

Subscribe the Meta app to the WhatsApp Business Account so phone-number webhook events are delivered to Schela.

The Schela webhook verifies POST signatures, caps request size, deduplicates provider retries, persists messages, tracks delivery/read/failure status, and routes replies to the exact interview conversation.

### 5.4 Test WhatsApp before launch

Use a non-production candidate phone and verify:

1. Create interview.
2. Approved template is sent.
3. `wamid` is persisted.
4. Candidate reply appears in Schela.
5. Groq produces one reply only.
6. Meta duplicate webhook does not duplicate the message/reply.
7. Delivered/read status updates correctly even if callbacks arrive out of order.
8. Invalid webhook signatures are rejected.

## 6. Resend — outbound + inbound email

### 6.1 Configure the sending domain

Add a sending domain in Resend and publish the DNS records Resend shows in the dashboard. Complete domain verification before production.

Set `EMAIL_FROM_ADDRESS` to a verified sender, for example:

```env
EMAIL_FROM_ADDRESS=Schela <scheduling@YOUR_DOMAIN>
```

### 6.2 Configure inbound receiving

Schela needs a receiving domain because every interview gets its own opaque reply alias.

For example:

```env
EMAIL_REPLY_TO=reply@replies.YOUR_DOMAIN
```

What matters is the domain after `@`. Schela dynamically generates interview-specific local parts on that same inbound domain.

Configure that domain/address in Resend Receiving Emails. You can initially use Resend's provided inbound domain for testing, then move to a branded custom inbound domain.

### 6.3 Resend webhook

Create a webhook endpoint:

```text
https://YOUR_DOMAIN/api/webhooks/resend
```

At minimum enable:

- `email.received`
- `email.sent`
- `email.delivered`
- `email.bounced`
- `email.failed`

Copy the signing secret to:

```env
RESEND_WEBHOOK_SECRET=whsec_...
```

Schela verifies the webhook using the raw HTTP request body before processing it.

### 6.4 Test email

Verify:

- 24h WhatsApp silence produces exactly one email fallback
- Replying to the interview-specific address continues the same Schela conversation
- a message from the wrong sender cannot hijack the candidate conversation
- duplicated/replayed Resend webhooks are idempotent
- bounce/failure state appears in the stored message status

## 7. Calendly

### 7.1 Create a Calendly OAuth application

Create a production OAuth app and use the exact redirect URI:

```text
https://YOUR_DOMAIN/api/integrations/calendly/callback
```

Schela uses OAuth with PKCE/S256.

The app requests only these scopes:

```text
event_types:read
scheduled_events:write
scheduling_links:write
webhooks:write
webhooks:read
```

Set:

```env
CALENDLY_CLIENT_ID=...
CALENDLY_CLIENT_SECRET=...
CALENDLY_WEBHOOK_SIGNING_KEY=...
```

### 7.2 Connect from Schela

After deployment:

1. Sign into Schela.
2. Open **Settings → Integrations**.
3. Connect Calendly.
4. Approve OAuth.
5. Select the default event type.
6. Optionally map event types to individual interviewers.

Schela creates/manages the Calendly webhook for the connected account. The callback route is:

```text
https://YOUR_DOMAIN/api/webhooks/calendly
```

The webhook validates the Calendly signature and rejects old timestamps outside its replay tolerance.

### 7.3 Test scheduling lifecycle

Verify:

- candidate scheduling intent generates a single-use Calendly link
- booking updates `scheduled_at` and meeting details
- confirmation goes back to candidate
- Calendly reschedule updates the same interview
- ordinary cancellation re-coordinates
- explicit candidate withdrawal closes the workflow and does not create another booking link

## 8. Groq

Create a Groq API key:

```env
GROQ_API_KEY=...
```

Schela currently uses the internally configured model:

```text
openai/gpt-oss-20b
```

There is deliberately no extra model env variable.

The AI layer uses a strict structured-output contract and then validates it again in application code. It is an orchestrator, not a free-running chat completion. It can reply to ordinary scheduling messages; risky or ambiguous cases create a recruiter action item instead.

Test these cases before launch:

- ordinary scheduling intent
- reschedule request
- candidate withdrawal
- compensation question
- visa/immigration question
- hiring-status question
- nonsense/ambiguous input
- Groq timeout/failure

No model-generated external URL should be sent directly to a candidate. Scheduling URLs must come from trusted Calendly application logic.

## 9. Deploy the Next.js app

Deploy with a Node 22+ runtime to your preferred platform.

Before production deployment, the platform must contain all 16 environment variables from `.env.example`.

Required public routes:

```text
GET  /api/health
GET  /api/webhooks/whatsapp       # Meta verification handshake
POST /api/webhooks/whatsapp
POST /api/webhooks/resend
POST /api/webhooks/calendly
GET  /api/integrations/calendly/connect
GET  /api/integrations/calendly/callback
POST /api/cron/followups
```

After deployment:

```bash
curl -i https://YOUR_DOMAIN/api/health
```

Expected result: an HTTP 200 JSON response with `{"ok":true}` when the database is reachable.

## 10. cron-job.org

Schela does not use Vercel Cron.

Create exactly one cron-job.org job:

```text
URL: https://YOUR_DOMAIN/api/cron/followups
Method: POST
Schedule: every 5 minutes
```

Add this custom header:

```text
Authorization: Bearer YOUR_CRON_SECRET
```

No request body is needed.

The endpoint rejects GET with 405 and unauthorized POST requests with 401.

One execution handles:

- 24-hour WhatsApp no-response → email fallback
- due 24-hour interview reminders
- due 1-hour interview reminders
- operational-data pruning

The worker intentionally claims small concurrent batches and has provider network timeouts so it stays inside cron-job.org's normal execution window.

### Test the cron endpoint manually

Without auth — must fail:

```bash
curl -i -X POST https://YOUR_DOMAIN/api/cron/followups
```

With auth:

```bash
curl -i -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  https://YOUR_DOMAIN/api/cron/followups
```

GET — must return 405:

```bash
curl -i https://YOUR_DOMAIN/api/cron/followups
```

## 11. Production security checklist

Before real candidate traffic:

- HTTPS only
- no secrets committed to Git
- `SUPABASE_SERVICE_ROLE_KEY` server-only
- Meta App Secret server-only
- Resend/Groq/Calendly secrets server-only
- random `CRON_SECRET`
- all provider webhook signatures verified
- RLS + table grants tested across two organizations
- auth redirect allowlist restricted to real environments
- sending and receiving email domains verified
- WhatsApp production number and approved template tested
- Calendly production OAuth app tested
- cron endpoint POST/auth tested
- CSP/security headers present
- no sensitive provider errors exposed to users
- operational logging checked for secret/PII leakage
- data-retention job runs successfully

If a secret was ever pasted into source control, logs, a public chat, screenshot, or client bundle, rotate it before launch.

## 12. Final launch sequence

Run these in order:

1. `npm install`
2. `npm run release:check`
3. `npm run typecheck`
4. `npm run build`
5. clean local/test `supabase db reset`
6. production `supabase db push --dry-run`
7. production `supabase db push`
8. deploy application with production env
9. verify `/api/health`
10. configure/verify Meta webhook + WABA subscription
11. configure/verify Resend webhook + receiving domain
12. connect production Calendly account
13. create cron-job.org POST job
14. run every P0 test in `docs/RELEASE_TEST_MATRIX.md`
15. run one full real candidate test from interview creation through booking/reminders
16. only then allow production recruiter/customer traffic

## 13. What “production ready” means for this repository

The Phase 6 codebase is a **production release candidate** once the static checks pass. It becomes production-ready for your deployment only after:

- the Next.js production build succeeds in your environment
- the 26 migrations apply cleanly to a fresh/test database
- live Meta, Resend, Calendly, Groq, Supabase and cron-job.org integration tests pass
- all P0 release tests pass

The repository intentionally does not claim those provider-side facts on your behalf.
