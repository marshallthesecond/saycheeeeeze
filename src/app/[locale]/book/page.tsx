// Loads packages, taken days and blackouts, then hands them to the form.
//
// Note what does not cross to the client: `bookings` has RLS on with no
// policies and is read here through the service-role client, which sends down
// only { date, status }. No names, phone numbers or prices reach the browser.

import type { Metadata } from "next";
import { DEFAULT_AVAILABILITY, toISODate, todayInTashkent } from "@/src/lib/availability";
import { expireStalePending, listBlackoutDates, listTakenDays } from "@/src/lib/bookings";
import { getBookablePackages } from "@/src/lib/packages.server";
import BookingClient from "./BookingClient";

export const metadata: Metadata = {
  title: "Book a session",
  description:
    "Book a photo session in Tashkent — portraits, graduation, fashion and commercial shoots. Pick a package, a date and a time.",
  openGraph: {
    title: "Book a session · saycheeeeeze",
    description:
      "Book a photo session in Tashkent — portraits, graduation, fashion and commercial shoots.",
  },
};

// A calendar cached for an hour will offer a day taken 59 minutes ago. The
// INSERT re-checks regardless, so the worst case is a "just taken" message.
export const revalidate = 60;

export default async function BookingPage() {
  const fromISO = toISODate(todayInTashkent());

  // Awaited, not fired and forgotten: the ledger read below has to happen
  // after it, or the calendar greys out days this call just released. There is
  // no cron — the booking flow sweeps itself, so a stale hold lives exactly
  // until the next person looks at the page, and can never block a booking
  // because the POST route sweeps again before inserting.
  await expireStalePending(DEFAULT_AVAILABILITY.pendingHoldHours);

  const [packages, taken, blackouts] = await Promise.all([
    getBookablePackages(),
    listTakenDays(fromISO),
    listBlackoutDates(fromISO),
  ]);

  return (
    <BookingClient
      packages={packages}
      taken={taken}
      blackouts={blackouts}
      availability={DEFAULT_AVAILABILITY}
    />
  );
}