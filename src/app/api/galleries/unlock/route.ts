// src/app/api/galleries/unlock/route.ts
//
// Trades a passkey for a cookie. The only endpoint in the app that accepts a
// secret, so it is deliberately small: parse, check, set cookie, done.
//
// Node runtime, not edge — gallery-access.ts uses node:crypto.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  checkPasskey,
  clientIp,
  issueAccessCookie,
} from "@/src/lib/gallery-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CODE_LENGTH = 128;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { slug, code } = (body ?? {}) as { slug?: unknown; code?: unknown };

  if (
    typeof slug !== "string" ||
    typeof code !== "string" ||
    !slug ||
    code.length > MAX_CODE_LENGTH
  ) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await checkPasskey(slug, code, clientIp(request.headers));

  if (result === "rate_limited") {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  if (result === "unavailable") {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (result === "invalid") {
    return NextResponse.json({ error: "invalid" }, { status: 401 });
  }

  const cookie = issueAccessCookie(slug);
  const jar = await cookies();

  jar.set(cookie.name, cookie.value, {
    httpOnly: true,       // JavaScript on the page never needs to read this
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",      // survives arriving from a Telegram link
    path: "/",
    maxAge: cookie.maxAge,
  });

  return NextResponse.json({ ok: true });
}