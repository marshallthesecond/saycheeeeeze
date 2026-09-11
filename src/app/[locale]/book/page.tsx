// src/app/[locale]/book/page.tsx
//
// Server shell. Loads the packages, the taken days and the blackout list, then
// hands them to the interactive form.
//
// Note what does NOT cross to the client: the bookings table has RLS on with
// zero policies, and this reads it server-side through the service-role client,
// sending down only an array of { date, status }. No names, no phone numbers,
// no prices ever reach the browser.

import type { Metadata } from "next";
import { DEFAULT_AVAILABILITY, toISODate, todayInTashkent } from "@/src/lib/availability";
import { listBlackoutDates, listTakenDays } from "@/src/lib/bookings";
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

// A calendar cached for an hour will happily offer a day that was taken 59
// minutes ago. One minute is a reasonable floor; the INSERT re-checks anyway,
// so the worst case is a "just taken" message rather than a double booking.
export const revalidate = 60;

export default async function BookingPage() {
  const fromISO = toISODate(todayInTashkent());

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