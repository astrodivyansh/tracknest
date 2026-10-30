import { describe, expect, it } from "vitest";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "./auth";

describe("sign-in rate limiting", () => {
  it("blocks an email after 5 failures and unblocks it after a successful sign-in", async () => {
    const email = `rl-${Date.now()}@test.local`;
    const ip = `10.0.0.${Date.now() % 250}`;
    for (let i = 0; i < 4; i++) await recordLoginFailure(email, ip);
    expect(await isLoginBlocked(email, ip)).toBe(false);
    await recordLoginFailure(email, ip);
    expect(await isLoginBlocked(email, ip)).toBe(true);
    expect(await isLoginBlocked(email, "10.9.9.9")).toBe(true); // a new IP doesn't help
    await clearLoginFailures(email);
    expect(await isLoginBlocked(email, ip)).toBe(false);
  });

  it("blocks an IP that tries many different emails", async () => {
    const ip = `10.1.${Date.now() % 250}.1`;
    for (let i = 0; i < 30; i++) await recordLoginFailure(`spray-${i}-${Date.now()}@test.local`, ip);
    expect(await isLoginBlocked("someone-new@test.local", ip)).toBe(true);
  });
});
