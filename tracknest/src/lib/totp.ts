import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time codes (RFC 6238), as shown by Google Authenticator, Microsoft Authenticator, 1Password…
const STEP_SECONDS = 30;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  return (bits.match(/.{1,5}/g) ?? []).map((c) => ALPHABET[parseInt(c.padEnd(5, "0"), 2)]).join("");
}

export function base32Decode(s: string) {
  const bits = [...s.replace(/[\s=]/g, "").toUpperCase()].map((c) => ALPHABET.indexOf(c).toString(2).padStart(5, "0")).join("");
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

export const newSecret = () => base32Encode(randomBytes(20));

/** The 6-digit code for one 30-second step. */
export function codeAt(secret: Buffer, step: number, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(n).padStart(digits, "0");
}

/**
 * The step a code matches (allowing one step of clock drift either way), or null. Steps at or before
 * `lastStep` are refused, so a code can't be used twice.
 */
export function verifyCode(secretB32: string, code: string, now = Date.now(), lastStep: number | null = null) {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretB32);
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(codeAt(secret, step)), Buffer.from(clean))) return step;
  }
  return null;
}

/** For the QR code an authenticator app scans. */
export const otpauthUri = (secret: string, account: string, issuer = "TrackNest") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
