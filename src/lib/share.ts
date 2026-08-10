import { randomInt } from "node:crypto";

// Ambiguous characters (0/O, 1/I/L) are removed so codes are easy to read aloud and type by hand.
const SHARE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateShareCode(length = 8) {
  let code = "";
  for (let index = 0; index < length; index += 1) code += SHARE_ALPHABET[randomInt(SHARE_ALPHABET.length)];
  return code;
}
