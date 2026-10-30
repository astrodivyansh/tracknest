import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeAt, verifyCode } from "./totp";

describe("two-step codes", () => {
  // RFC 6238 appendix B: SHA-1 secret "12345678901234567890", T = 59s → 94287082 (8 digits).
  const secret = Buffer.from("12345678901234567890");
  it("matches the RFC test vectors", () => {
    expect(codeAt(secret, 1, 8)).toBe("94287082");
    expect(codeAt(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
  });

  it("round-trips base32 and accepts a code once, with one step of drift", () => {
    const b32 = base32Encode(secret);
    expect(base32Decode(b32)).toEqual(secret);
    const now = 1_800_000_000_000;
    const step = Math.floor(now / 30000);
    const code = codeAt(secret, step);
    expect(verifyCode(b32, code, now)).toBe(step);
    expect(verifyCode(b32, code, now + 30000)).toBe(step); // phone clock slightly behind
    expect(verifyCode(b32, code, now + 90000)).toBeNull(); // too old
    expect(verifyCode(b32, code, now, step)).toBeNull(); // already used
    expect(verifyCode(b32, "12345", now)).toBeNull();
  });
});
