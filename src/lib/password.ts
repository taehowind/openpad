import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

export function hashPassword(plain: string) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain: string, hash: string | null | undefined) {
  if (!hash) return false;
  try {
    return bcrypt.compareSync(plain, hash);
  } catch {
    return false;
  }
}

/** Compares a shared secret that is stored as written, without leaking its length or contents. */
export function matchesSecret(given: string, stored: string) {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(stored, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);   // keep the work constant even when the lengths give it away
    return false;
  }
  return timingSafeEqual(a, b);
}
