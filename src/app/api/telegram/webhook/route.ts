// The Telegram bot's one endpoint. Two jobs, both of which were promised by
// the UI and implemented by nothing:
//
//   1. Marshall taps Approve / Decline on the booking notification.
//      /api/booking/route.ts has been sending inline buttons with
//      callback_data "bk:confirm:<ref>" since the beginning, and no route
//      existed to receive the callback_query. The buttons spun forever.
//
//   2. The client taps "Get updates on Telegram" on the confirmation screen,
//      which opens t.me/<bot>?start=<ref>. Telegram delivers that as the
//      message "/start <ref>". bindTelegramChat() has been sitting in
//      bookings.ts with zero callers, so pressing Start bound nothing and the
//      client was never messaged — under a button whose own label says
//      "Tap Start and I'll message you here".
//
// SECURITY. This URL is public and unauthenticated by nature, so:
//
//   - Telegram signs every delivery with the secret_token given at setWebhook
//     time, echoed back in X-Telegram-Bot-Api-Secret-Token. Compared in
//     constant time. Without TELEGRAM_WEBHOOK_SECRET set, the route refuses
//     everything rather than running open.
//   - Approve/Decline additionally require the callback to come from
//     TELEGRAM_ADMIN_CHAT_ID. The secret alone would let anyone who learned it
//     confirm bookings; this is the second lock, and it is the one that matters.
//   - /start binding is deliberately NOT admin-only — it is the client's own
//     action. bindTelegramChat() carries its own rules: it binds only when no
//     chat is bound yet and the booking is under a week old, so a leaked
//     reference cannot be used to redirect someone else's notifications.
//
// Telegram retries any delivery it does not get a 200 for, so this returns 200
// for anything it understands and anything it does not. A permanent 500 on a
// malformed update would have Telegram resending it for hours.
//
// Register it with: node scripts/set-telegram-webhook.mjs

import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { describeSlot } from "@/src/lib/availability";
import {
  bindTelegramChat,
  getBookingByRef,
  setBookingStatus,
} from "@/src/lib/bookings";
import { formatSom, pick } from "@/src/lib/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API = "https://api.telegram.org/bot";

/**
 * Same escape the notification uses — three characters, HTML.
 *
 * Both sides moved off MarkdownV2 after it silently killed every admin
 * notification: it reserves eighteen characters everywhere, including inside
 * bold and italic, so a single unescaped full stop in a hard-coded sentence
 * takes the whole message down with a 400. These messages are assembled from
 * client-supplied names and notes, which is the worst possible input for a
 * format that strict.
 */
function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Equal lengths first, or timingSafeEqual throws instead of returning false.
  return x.length === y.length && timingSafeEqual(x, y);
}

async function call(method: string, payload: unknown): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`${API}${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error(`Telegram ${method} failed:`, await res.text());
  } catch (e) {
    // A failed reply must not fail the webhook — Telegram would redeliver the
    // update and the decision would be applied twice.
    console.error(`Telegram ${method} threw:`, String(e));
  }
}

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not set — refusing every update.");
    return NextResponse.json({ ok: true });
  }

  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!safeEqual(header, secret)) {
    // 401, not 200: this is not Telegram, so there is no redelivery to avoid.
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    if (update.callback_query) await handleDecision(update.callback_query);
    else if (update.message?.text) await handleMessage(update.message);
  } catch (e) {
    console.error("Telegram webhook:", String(e));
  }

  // Always 200 once it is genuinely Telegram. Anything else is a redelivery.
  return NextResponse.json({ ok: true });
}

// Approve / Decline

async function handleDecision(cq: CallbackQuery): Promise<void> {
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID;
  const from = String(cq.from?.id ?? "");
  const chat = String(cq.message?.chat?.id ?? "");

  // The real lock. Telegram authenticates the sender for us, so comparing the
  // id is enough — and it is what stops the secret alone being sufficient.
  if (!admin || (from !== admin && chat !== admin)) {
    await call("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "Not your booking to decide.",
      show_alert: true,
    });
    return;
  }

  const [tag, action, ref] = (cq.data ?? "").split(":");
  if (tag !== "bk" || (action !== "confirm" && action !== "decline") || !ref) {
    await call("answerCallbackQuery", { callback_query_id: cq.id });
    return;
  }

  const existing = await getBookingByRef(ref);
  if (!existing) {
    await call("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: `No booking ${ref}.`,
      show_alert: true,
    });
    return;
  }

  const status = action === "confirm" ? "confirmed" : "declined";
  const slot = describeSlot(existing.startTime, existing.durationMinutes);

  // Idempotent on purpose: Telegram redelivers an update it did not get a 200
  // for, and a double tap is the most likely thing to happen to a button that
  // used to do nothing.
  if (existing.status === status) {
    await call("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: action === "confirm" ? `${ref} already approved.` : `${ref} already declined.`,
    });
    return;
  }

  const updated = await setBookingStatus(ref, status);
  if (!updated) {
    await call("answerCallbackQuery", {
      callback_query_id: cq.id,
      text: "The write was rejected. Try again.",
      show_alert: true,
    });
    return;
  }

  await call("answerCallbackQuery", {
    callback_query_id: cq.id,
    text: action === "confirm" ? "Approved" : "Declined",
  });

  // Replace the buttons with the outcome. Leaving them live invites a second
  // tap and gives no record in the chat of what was decided.
  if (cq.message) {
    await call("editMessageReplyMarkup", {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text:
                action === "confirm"
                  ? `✅ Approved · ${existing.sessionDate} ${slot}`
                  : `❌ Declined · ${existing.sessionDate} is free again`,
              callback_data: "bk:noop",
            },
          ],
          ...(existing.telegramUsername
            ? [[{ text: "💬 Message client", url: `https://t.me/${existing.telegramUsername.slice(1)}` }]]
            : []),
        ],
      },
    });
  }

  // Tell the client, if they ever pressed Start. Most will not have, which is
  // what the phone number on the booking is for.
  if (updated.telegramChatId) {
    const money = formatSom(updated.priceUzs, updated.locale || "en");
    const name = pick(updated.packageName, "en");
    await call("sendMessage", {
      chat_id: updated.telegramChatId,
      parse_mode: "HTML",
      text:
        action === "confirm"
          ? `✅ <b>Your session is confirmed</b>\n\n${esc(name)}\n📅 ${esc(updated.sessionDate)} · ${esc(slot)}\n💰 ${esc(money)}\n<code>${esc(ref)}</code>`
          : `Your request for ${esc(updated.sessionDate)} could not be taken. Message me and we will find another day.\n\n<code>${esc(ref)}</code>`,
    });
  }
}

// /start <ref> — the client linking their chat

async function handleMessage(msg: TelegramMessage): Promise<void> {
  const text = (msg.text ?? "").trim();
  const chatId = msg.chat?.id;
  if (!chatId) return;

  if (!text.startsWith("/start")) {
    await call("sendMessage", {
      chat_id: chatId,
      text: "Book a session at saycheeeeeze and I will send your confirmation here.",
    });
    return;
  }

  // "/start SC-7F3K2" — Telegram appends the ?start= payload as an argument.
  const ref = text.split(/\s+/)[1]?.trim().toUpperCase();
  if (!ref) {
    await call("sendMessage", {
      chat_id: chatId,
      text: "Hi! Open this link from your booking confirmation and I will keep you posted about that session.",
    });
    return;
  }

  const bound = await bindTelegramChat(ref, chatId);

  // bindTelegramChat returns null for an unknown ref, one already bound, or one
  // older than a week — all three are refusals, and they are reported
  // identically so a stranger holding a reference learns nothing about whether
  // it is real.
  if (!bound) {
    await call("sendMessage", {
      chat_id: chatId,
      text: "I couldn't link that booking. If it is yours and recent, message Marshall directly and he will sort it.",
    });
    return;
  }

  const slot = describeSlot(bound.startTime, bound.durationMinutes);
  await call("sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `👋 Linked. I will message you here when <b>${esc(bound.sessionDate)} · ${esc(slot)}</b> is confirmed.\n\n<code>${esc(ref)}</code>`,
  });
}

// The slice of Telegram's update shape this route reads.

interface TelegramChat {
  id: number;
}
interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
}
interface CallbackQuery {
  id: string;
  data?: string;
  from?: { id: number };
  message?: TelegramMessage;
}
interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
}
