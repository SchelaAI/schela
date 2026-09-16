import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const notes = [];

function fail(message) { failures.push(message); }
function note(message) { notes.push(message); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }

const expectedEnv = [
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'CALENDLY_CLIENT_ID',
  'CALENDLY_CLIENT_SECRET',
  'CALENDLY_WEBHOOK_SIGNING_KEY',
  'EMAIL_REPLY_TO',
  'RESEND_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'RESEND_WEBHOOK_SECRET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GROQ_API_KEY',
  'CRON_SECRET',
];

const envText = read('.env.example');
const envKeys = [...envText.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
const missingEnv = expectedEnv.filter((key) => !envKeys.includes(key));
const extraEnv = envKeys.filter((key) => !expectedEnv.includes(key));
if (missingEnv.length) fail(`.env.example missing: ${missingEnv.join(', ')}`);
if (extraEnv.length) fail(`Unexpected required env keys: ${extraEnv.join(', ')}`);

if (exists('vercel.json')) fail('vercel.json exists; Schela must not depend on Vercel Cron.');

const migrationDir = path.join(root, 'supabase', 'migrations');
const migrations = fs.readdirSync(migrationDir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();
for (let i = 1; i <= 26; i += 1) {
  const prefix = String(i).padStart(4, '0') + '_';
  if (!migrations.some((name) => name.startsWith(prefix))) fail(`Missing migration ${prefix}*.sql`);
}
if (migrations.length !== 26) fail(`Expected 26 canonical migrations; found ${migrations.length}.`);

const requiredRoutes = [
  'app/api/health/route.ts',
  'app/api/cron/followups/route.ts',
  'app/api/webhooks/whatsapp/route.ts',
  'app/api/webhooks/resend/route.ts',
  'app/api/webhooks/calendly/route.ts',
  'app/api/integrations/calendly/connect/route.ts',
  'app/api/integrations/calendly/callback/route.ts',
];
for (const route of requiredRoutes) if (!exists(route)) fail(`Missing required route: ${route}`);

const cron = read('app/api/cron/followups/route.ts');
if (!cron.includes('export async function POST')) fail('Cron endpoint must expose POST.');
if (!cron.includes('status: 405')) fail('Cron endpoint should reject GET with 405.');
if (!cron.includes('CRON_SECRET')) fail('Cron endpoint is not protected by CRON_SECRET.');

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(root);

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  if (/^[\s\S]*?["']use client["'];/.test(content) && content.includes('SUPABASE_SERVICE_ROLE_KEY')) {
    fail(`Service-role key referenced from a client component: ${rel}`);
  }
  if (/^[\s\S]*?["']use client["'];/.test(content) && content.includes('WHATSAPP_ACCESS_TOKEN')) {
    fail(`WhatsApp access token referenced from a client component: ${rel}`);
  }
  if (/^[\s\S]*?["']use client["'];/.test(content) && content.includes('CALENDLY_CLIENT_SECRET')) {
    fail(`Calendly client secret referenced from a client component: ${rel}`);
  }
  if (/^[\s\S]*?["']use client["'];/.test(content) && content.includes('RESEND_API_KEY')) {
    fail(`Resend API key referenced from a client component: ${rel}`);
  }
  if (/^[\s\S]*?["']use client["'];/.test(content) && content.includes('GROQ_API_KEY')) {
    fail(`Groq API key referenced from a client component: ${rel}`);
  }
}

const nextConfig = read('next.config.ts');
for (const header of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options']) {
  if (!nextConfig.includes(header)) fail(`Missing security header in next.config.ts: ${header}`);
}

const packageJson = JSON.parse(read('package.json'));
const nodeEngine = packageJson.engines?.node ?? '';
if (!nodeEngine.includes('22')) fail(`Node engine should require Node 22+; found ${nodeEngine || 'none'}.`);

note(`Environment contract: ${envKeys.length} keys`);
note(`Canonical migrations: ${migrations.length}`);
note(`TypeScript/TSX files inspected for secret leakage: ${sourceFiles.length}`);
note('No Vercel Cron configuration detected');

for (const message of notes) console.log(`✓ ${message}`);
if (failures.length) {
  console.error('\nRelease preflight failed:');
  for (const message of failures) console.error(`✗ ${message}`);
  process.exit(1);
}
console.log('\n✓ Static release preflight passed.');
console.log('Next: npm run typecheck && npm run build, then complete docs/RELEASE_TEST_MATRIX.md against live providers.');
