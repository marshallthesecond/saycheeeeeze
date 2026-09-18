// Why didn't the booking notification arrive? This answers it in one run.
//
//   node --env-file=.env.local scripts/check-telegram.mjs
//   node --env-file=.env.local scripts/check-telegram.mjs --find-chat
//
// Checks, in the order they fail in practice:
//
//   1. the env vars exist
//   2. the bot token is real            getMe
//   3. the webhook is registered        getWebhookInfo, and its LAST ERROR —
//                                       which is where Telegram records a
//                                       rejected callback
//   4. the admin chat can be reached    a real sendMessage, with the same
//                                       HTML the booking route uses
//
// Step 4 is the one that matters. A bot cannot open a conversation with a
// person who has never pressed Start on it — including you. If the token and
// the chat id are both right and it still fails with 403, open the bot in
// Telegram, press Start, and run this again.
//
// --find-chat prints the chat ids that have messaged the bot, for filling in
// TELEGRAM_ADMIN_CHAT_ID. It needs the webhook temporarily removed, because
// Telegram will not serve getUpdates while one is registered — the script says
// so rather than failing at you.
//
// NOTE: this reads .env.local, i.e. what `pnpm dev` uses. If the booking you
// tested was made on the deployed site, the variables that matter are the ones
// in the Vercel dashboard, and they are set separately.

import process from "node:process";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN = process.env.TELEGRAM_ADMIN_CHAT_ID;
const BOTUSER = process.env.TELEGRAM_BOT_USERNAME;
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");

const findChat = process.argv.includes("--find-chat");

const ok = (m) => console.log(`  ✓  ${m}`);
const bad = (m) => console.log(`  ✗  ${m}`);
const info = (m) => console.log(`     ${m}`);

if (!TOKEN) {
  bad("TELEGRAM_BOT_TOKEN is not set.");
  info("Run with:  node --env-file=.env.local scripts/check-telegram.mjs");
  process.exit(1);
}

const api = async (method, payload) => {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: AbortSignal.timeout(15000),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: `network: ${String(e)}` };
  }
};

console.log("\nEnvironment\n");
ok("TELEGRAM_BOT_TOKEN set");
ADMIN ? ok(`TELEGRAM_ADMIN_CHAT_ID = ${ADMIN}`) : bad("TELEGRAM_ADMIN_CHAT_ID is NOT set — no notification can be sent");
BOTUSER ? ok(`TELEGRAM_BOT_USERNAME = ${BOTUSER}`) : bad("TELEGRAM_BOT_USERNAME is NOT set — the client's \"Get updates\" button will not render");
SECRET && SECRET.length >= 32
  ? ok("TELEGRAM_WEBHOOK_SECRET set")
  : bad("TELEGRAM_WEBHOOK_SECRET missing or under 32 chars — the webhook refuses every update");
SITE ? ok(`NEXT_PUBLIC_SITE_URL = ${SITE}`) : bad("NEXT_PUBLIC_SITE_URL is NOT set");

console.log("\nBot\n");
const me = await api("getMe");
if (!me.ok) {
  bad(`getMe failed: ${me.description}`);
  info("The token is wrong or revoked. Get a fresh one from @BotFather.");
  process.exit(1);
}
ok(`@${me.result.username} (${me.result.first_name})`);
if (BOTUSER && BOTUSER.replace(/^@/, "") !== me.result.username) {
  bad(`TELEGRAM_BOT_USERNAME says "${BOTUSER}" but the token belongs to "@${me.result.username}"`);
  info("The client's Start link points at the wrong bot, so binding will never work.");
}

if (findChat) {
  console.log("\nChats that have messaged this bot\n");
  const updates = await api("getUpdates", { limit: 20 });
  if (!updates.ok && /webhook is active/i.test(updates.description ?? "")) {
    bad("A webhook is registered, and Telegram will not serve getUpdates while one is.");
    info("Remove it, message your bot, re-run this, then register it again:");
    info("  node --env-file=.env.local scripts/set-telegram-webhook.mjs --delete");
    info("  node --env-file=.env.local scripts/check-telegram.mjs --find-chat");
    info("  node --env-file=.env.local scripts/set-telegram-webhook.mjs");
    process.exit(1);
  }
  const seen = new Map();
  for (const u of updates.result ?? []) {
    const c = u.message?.chat ?? u.callback_query?.message?.chat;
    if (c) seen.set(c.id, [c.type, c.title ?? "", c.username ?? "", c.first_name ?? ""].filter(Boolean).join(" · "));
  }
  if (seen.size === 0) {
    bad("No messages yet. Open the bot in Telegram, send it anything, and re-run.");
  } else {
    for (const [id, who] of seen) ok(`${String(id).padEnd(16)} ${who}`);
    info("");
    info("Put the one that is you in .env.local as TELEGRAM_ADMIN_CHAT_ID.");
  }
  process.exit(0);
}

console.log("\nWebhook\n");
const hook = await api("getWebhookInfo");
const r = hook.result ?? {};
if (!r.url) {
  bad("No webhook registered — Approve / Decline buttons will do nothing.");
  info("node --env-file=.env.local scripts/set-telegram-webhook.mjs");
} else {
  ok(`registered: ${r.url}`);
  if (r.pending_update_count) info(`pending updates: ${r.pending_update_count}`);
  // Telegram keeps last_error_message FOREVER — it is not cleared by a later
  // successful delivery. Reporting it as news sends you chasing a problem you
  // already fixed, so probe the endpoint ourselves before saying anything.
  //
  // A Next route that exports only POST answers GET with 405. 404 means the
  // file genuinely is not in the deployed build.
  let live = null;
  try {
    const probe = await fetch(r.url, { method: "GET", signal: AbortSignal.timeout(15000) });
    live = probe.status;
  } catch {
    live = null;
  }
  if (live === 405 || live === 200) {
    ok(`endpoint is live (GET → ${live}, which is what a POST-only route answers)`);
  } else if (live === 404) {
    bad("endpoint returns 404 — the route is not in the deployed build.");
  } else if (live === null) {
    bad("endpoint unreachable from here.");
  } else {
    info(`endpoint answered GET with ${live}`);
  }

  if (r.last_error_message) {
    const stale = live === 405 || live === 200;
    (stale ? info : bad)(
      `${stale ? "historic" : "last"} delivery error: ${r.last_error_message}`,
    );
    info(`at ${new Date((r.last_error_date ?? 0) * 1000).toISOString()}`);
    // The status code says which of three very different problems it is, so
    // guessing at one of them is worse than useless.
    const err = String(r.last_error_message);
    if (stale) {
      info("");
      info("The endpoint answers now, so this is a record of a past failure and not");
      info("a current one. Telegram never clears it; it will sit here until the next");
      info("genuine failure overwrites it. Nothing to do.");
    } else if (/404/.test(err)) {
      info("");
      info("404 = the route is not on the deployed site. The webhook is pointing at a");
      info("build that predates src/app/api/telegram/webhook/route.ts. Commit, push,");
      info("let Vercel finish, then re-run this. Nothing else here is wrong.");
    } else if (/401|403/.test(err)) {
      info("");
      info("401 = TELEGRAM_WEBHOOK_SECRET differs between Vercel and the registration.");
      info("Set the Vercel value to match, redeploy, then re-run set-telegram-webhook.mjs.");
    } else if (/5\d\d/.test(err)) {
      info("");
      info("A 5xx means the route ran and threw. The stack is in the Vercel logs for");
      info("/api/telegram/webhook.");
    }
    if (r.pending_update_count) {
      info("");
      info(`Telegram is still holding ${r.pending_update_count} update(s) and will retry`);
      info("them once the endpoint answers, so nothing tapped so far is lost.");
    } else if (!stale) {
      info("");
      info("No updates queued, so nothing is waiting to be retried.");
    }
  }
  if (SITE && !String(r.url).startsWith(SITE)) {
    bad(`registered against ${r.url}, but NEXT_PUBLIC_SITE_URL is ${SITE}`);
    info("Callbacks are going to a different deployment than the one you are testing.");
  }
}

console.log("\nDelivery to the admin chat\n");
if (!ADMIN) {
  bad("Skipped — TELEGRAM_ADMIN_CHAT_ID is not set.");
  info("Find it with:  node --env-file=.env.local scripts/check-telegram.mjs --find-chat");
  process.exit(1);
}

// The same shape and the same parse mode the booking route uses, so a format
// problem shows up here rather than on a real booking.
const esc = (s) => s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
const test = [
  `\u{1F4F8} <b>Test notification</b> · <code>SC-TEST00</code>`,
  ``,
  `<b>${esc("Photo session — 1.5 hours")}</b> — 400 000 so'm`,
  `\u{1F4C5} 2026-09-20 · 09:00–10:30`,
  ``,
  `<i>If you can read this, booking notifications work.</i>`,
].join("\n");

const sent = await api("sendMessage", {
  chat_id: ADMIN,
  text: test,
  parse_mode: "HTML",
  disable_web_page_preview: true,
});

if (sent.ok) {
  ok("Sent. Check Telegram — the message should be there now.");
  console.log("\n  Everything the booking route needs is working.\n");
  process.exit(0);
}

bad(`sendMessage failed: ${sent.description}`);
const d = String(sent.description ?? "");
if (/can't initiate conversation|bot was blocked|chat not found/i.test(d)) {
  info("");
  info("This is the usual one, and it applies to you as much as to a client:");
  info("a bot cannot message someone who has never started a chat with it.");
  info(`Open @${me.result.username} in Telegram, press START, then re-run this.`);
  info("If it is a group chat, add the bot to the group and send one message there.");
} else if (/parse entities|can't parse/i.test(d)) {
  info("");
  info("A formatting error. That is what MarkdownV2 was doing before 2026-09-18 —");
  info("one unescaped '.' in a hard-coded line rejected the entire message.");
} else if (/chat_id is empty|invalid/i.test(d)) {
  info("");
  info(`TELEGRAM_ADMIN_CHAT_ID = "${ADMIN}" does not look like a chat id.`);
  info("It is a number, possibly negative for a group. Find it with --find-chat.");
}
console.log();
process.exit(1);
