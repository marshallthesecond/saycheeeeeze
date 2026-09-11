// src/app/api/booking/status/route.ts
//
// ⚠ TRANSITIONAL. This still uses the token-in-URL approve links, which is the
// thing the Telegram webhook is meant to replace: the token lands in your
// browser history and in every logging hop between Telegram and the server, and
// any prefetcher that opens one silently approves a booking.
//
// It is patched here only so the build passes and you can still approve
// bookings today. Delete this file once /api/telegram/webhook is live and the
// admin message carries inline callback buttons instead of links.
//
//   GET /api/booking/status?ref=SC-7F3K2&action=confirm&token=…

import { NextRequest, NextResponse } from "next/server";
import { describeSlot } from "@/src/lib/availability";
import { getBookingByRef, setBookingStatus } from "@/src/lib/bookings";
import { formatSom, pick } from "@/src/lib/packages";

function page(title: string, detail: string, tone: "ok" | "warn" | "bad") {
  const colour = tone === "ok" ? "#506477" : tone === "warn" ? "#c9a227" : "#c25b52";
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title></head>
     <body style="margin:0;background:#111315;color:#fff;font-family:system-ui,sans-serif;
                  display:flex;align-items:center;justify-content:center;min-height:100vh">
       <div style="text-align:center;padding:24px;max-width:420px">
         <div style="width:56px;height:56px;border-radius:50%;background:${colour};
                     margin:0 auto 20px"></div>
         <h1 style="font-size:20px;margin:0 0 8px">${title}</h1>
         <p style="color:#ffffff99;font-size:14px;line-height:1.5;margin:0">${detail}</p>
       </div>
     </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const ADMIN = process.env.BOOKING_ADMIN_TOKEN;
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const ref = searchParams.get("ref");
  const action = searchParams.get("action");

  if (!ADMIN) return page("Not configured", "BOOKING_ADMIN_TOKEN isn't set on the server.", "bad");
  if (token !== ADMIN) return page("Not allowed", "That link isn't valid.", "bad");
  if (!ref) return page("Missing reference", "No booking reference in the link.", "bad");
  if (action !== "confirm" && action !== "decline") {
    return page("Unknown action", "Use action=confirm or action=decline.", "bad");
  }

  const existing = await getBookingByRef(ref);
  if (!existing) {
    return page("Not found", `No booking with reference ${ref}.`, "warn");
  }

  const status = action === "confirm" ? "confirmed" : "declined";
  const slot = describeSlot(existing.startTime, existing.durationMinutes);

  if (existing.status === status) {
    return page(
      action === "confirm" ? "Already approved" : "Already declined",
      `${ref} — ${existing.clientName}, ${existing.sessionDate} ${slot}.`,
      "warn"
    );
  }

  const updated = await setBookingStatus(ref, status);
  if (!updated) return page("Couldn't update", "The write was rejected. Try again.", "bad");

  const contact = updated.telegramUsername || updated.phone || "no contact on file";
  const money = formatSom(updated.priceUzs, "en");
  const name = pick(updated.packageName, "en");

  return action === "confirm"
    ? page(
        "Approved",
        `${ref} — ${updated.clientName}, ${name}, ${updated.sessionDate} ${slot}, ${money}. Message them: ${contact}`,
        "ok"
      )
    : page(
        "Declined",
        `${ref} — ${updated.clientName}. ${updated.sessionDate} is free again. Let them know: ${contact}`,
        "warn"
      );
}