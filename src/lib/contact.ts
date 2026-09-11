// src/lib/contact.ts
//
// Where clients reach you. One line each, no logic.
//
// This lived in gallery.ts, whose own header says "import it from client
// components only" — it holds the zip builder, the share sheet and the file
// cache. The service pages are SERVER components and need nothing from that
// module except these two strings, so pulling the whole of it across the
// boundary to read a Telegram handle was the wrong shape even though it
// happened to work: gallery.ts has no top-level browser access today, and the
// day someone adds one, every service page breaks at build time for a reason
// that has nothing to do with services.
//
// gallery.ts re-exports CONTACT, so existing client-side imports are unchanged.
export const CONTACT = {
  telegram: "saycheeeeeze",          // ← your Telegram username, no @
  email: "hello@saycheeeeeze.uz",    // ← your inbox
};
