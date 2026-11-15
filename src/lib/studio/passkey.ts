// Passkeys the Studio makes up when the photographer does not type one.

import "server-only";

import { randomInt } from "node:crypto";

// Capitals and digits, because the gate on the public site asks a phone
// keyboard for capitals (autoCapitalize="characters") and compares the code
// exactly as typed. Without 0/O, 1/I/L: they are the ones read out wrong.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const PASSKEY_MIN = 6;
export const PASSKEY_MAX = 64;

/** Eight characters from 31: about 850 billion possibilities. */
export function generatePasskey(length = 8): string {
  let out = "";
  // randomInt, not Math.random: this is a secret.
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
