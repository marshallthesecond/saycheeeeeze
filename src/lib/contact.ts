// Where clients reach you.
//
// Separate from gallery.ts (which holds the zip builder and the share sheet)
// so server components can read a Telegram handle without importing a
// browser-only module. gallery.ts re-exports CONTACT for existing callers.
export const CONTACT = {
  telegram: "saycheeeeeze",          // Telegram username, no @
  email: "hello@saycheeeeeze.uz",
};
