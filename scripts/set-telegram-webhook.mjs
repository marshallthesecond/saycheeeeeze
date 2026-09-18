// Points the Telegram bot at /api/telegram/webhook. Run once per deployment
// URL, and again whenever TELEGRAM_WEBHOOK_SECRET changes.
//
//   node --env-file=.env.local scripts/set-telegram-webhook.mjs
//   node --env-file=.env.local scripts/set-telegram-webhook.mjs --status
//   node --env-file=.env.local scripts/set-telegram-webhook.mjs --delete
//
// Until this has run, the Approve/Decline buttons on the booking notification
// do nothing at all: Telegram has nowhere to deliver the callback. That was the
// state of the world before 2026-09-18.
//
// Needs, in .env.local:
//   TELEGRAM_BOT_TOKEN        from @BotFather
//   TELEGRAM_WEBHOOK_SECRET   any 32+ random chars. Generate one with node,
//                             which is already installed because this script
//                             runs on it — Windows has no openssl:
//                               node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//   NEXT_PUBLIC_SITE_URL      https://saycheeeeeze.vercel.app
//
// The secret must also be set in the Vercel dashboard, or the deployed route
// refuses every update. The URL must be https and public; localhost will be
// rejected by Telegram, so test approvals against a preview deployment.

import process from "node:process";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

const argv = process.argv.slice(2);
const wants = (flag) => argv.includes(flag);

if (!TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Run with --env-file=.env.local");
  process.exit(1);
}

const api = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
  return res.json();
};

if (wants("--status")) {
  const info = await api("getWebhookInfo");
  const r = info.result ?? {};
  console.log(`\n  url                  ${r.url || "(none set)"}`);
  console.log(`  pending updates      ${r.pending_update_count ?? 0}`);
  console.log(`  secret configured    ${r.has_custom_certificate ? "cert" : SECRET ? "yes (locally)" : "NO"}`);
  if (r.last_error_message) {
    console.log(`  last error           ${r.last_error_message}`);
    console.log(`  last error at        ${new Date((r.last_error_date ?? 0) * 1000).toISOString()}`);
  }
  console.log();
  process.exit(0);
}

if (wants("--delete")) {
  const out = await api("deleteWebhook", { drop_pending_updates: true });
  console.log(out.ok ? "\n  Webhook removed. Buttons will stop working.\n" : out);
  process.exit(out.ok ? 0 : 1);
}

if (!SECRET || SECRET.length < 32) {
  console.error("TELEGRAM_WEBHOOK_SECRET must be at least 32 characters.");
  console.error(
    'Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  );
  process.exit(1);
}
if (!SITE.startsWith("https://")) {
  console.error(`NEXT_PUBLIC_SITE_URL must be a public https URL. Got: ${SITE || "(empty)"}`);
  process.exit(1);
}

const url = `${SITE}/api/telegram/webhook`;

// allowed_updates is a whitelist, not a filter: anything omitted is never
// delivered, which keeps the endpoint's surface to exactly the two things it
// handles.
const out = await api("setWebhook", {
  url,
  secret_token: SECRET,
  allowed_updates: ["message", "callback_query"],
  drop_pending_updates: true,
});

if (!out.ok) {
  console.error("\n  setWebhook failed:", out.description ?? out, "\n");
  process.exit(1);
}

console.log(`\n  Webhook set: ${url}`);
console.log("  Approve / Decline on the booking notification now work.");
console.log("  So does the client's \"Get updates\" button.\n");
console.log("  Make sure TELEGRAM_WEBHOOK_SECRET is set in Vercel too, as a Secret");
console.log("  variable — the route refuses every update without it.\n");
