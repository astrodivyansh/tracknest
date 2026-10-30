import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { passesTwoStep } from "./auth";
import { base32Decode, codeAt, newSecret } from "./totp";
import { parseCustom, showCustom, type FieldDef } from "./custom-fields";
import { depreciate } from "./depreciation";
import { can } from "./permissions";
import { fyBounds, fyLabel } from "./reports";

describe("permissions", () => {
  const u = (role: "viewer" | "manager" | "admin", perms: string[] | null = null, disabled: string[] = []) => ({ role, perms, disabled });
  it("groups narrow managers only, and org switches apply to everyone", () => {
    expect(can(u("viewer"), "checkout")).toBe(false);
    expect(can(u("manager"), "dispose")).toBe(true);
    expect(can(u("manager", ["checkout"]), "dispose")).toBe(false);
    expect(can(u("manager", ["checkout"]), "checkout")).toBe(true);
    expect(can(u("admin", []), "dispose")).toBe(true); // a leftover group never limits an admin
    expect(can(u("admin", null, ["dispose"]), "dispose")).toBe(false);
  });
});

describe("depreciation methods", () => {
  const asset = { cost: "15000.00", purchaseDate: "2020-01-01" };
  const at = (y: number) => new Date(Date.UTC(2020, 0, 1) + y * 365.25 * 864e5);
  const rule = (depMethod: "double_declining" | "sum_of_years", life: string) => ({ depMethod, depLifeYears: life, depRatePct: null, depSalvagePct: "0" });

  it("sum of the years' digits: 5/15, 4/15, … of the cost each year", () => {
    expect(depreciate(asset, rule("sum_of_years", "5.00"), at(1))?.bookValue).toBeCloseTo(10000, 0);
    expect(depreciate(asset, rule("sum_of_years", "5.00"), at(2))?.bookValue).toBeCloseTo(6000, 0);
    expect(depreciate(asset, rule("sum_of_years", "5.00"), at(2.5))?.bookValue).toBeCloseTo(4500, 0); // half of year 3's 3000
    expect(depreciate(asset, rule("sum_of_years", "5.00"), at(9))?.bookValue).toBe(0);
    expect(depreciate(asset, rule("sum_of_years", "4.50"), at(1))).toBeNull(); // needs whole years
  });

  it("double declining: twice the straight-line rate", () => {
    expect(depreciate(asset, rule("double_declining", "5.00"), at(1))?.bookValue).toBeCloseTo(9000, 0); // 40% a year
    expect(depreciate(asset, rule("double_declining", "5.00"), at(2))?.bookValue).toBeCloseTo(5400, 0);
  });
});

describe("custom field types", () => {
  const f = (type: FieldDef["type"], options: string[] = []): FieldDef => ({ id: type, label: type, type, options, required: false, categoryId: null });
  it("parses and shows the new types", () => {
    const defs = [f("multiselect", ["Wi-Fi", "Bluetooth", "4G"]), f("currency"), f("email"), f("url"), f("textarea")];
    const { values, errors } = parseCustom(defs, { multiselect: "bluetooth\nWi-Fi", currency: "₹1,250.499", email: "a@b.in", url: "example.com/x", textarea: "line 1\nline 2" }, null);
    expect(errors).toEqual([]);
    expect(values).toEqual({ multiselect: ["Bluetooth", "Wi-Fi"], currency: 1250.5, email: "a@b.in", url: "https://example.com/x", textarea: "line 1\nline 2" });
    expect(showCustom(defs[0], values.multiselect)).toBe("Bluetooth, Wi-Fi");
    expect(showCustom(defs[1], values.currency)).toBe("1,250.50");
    expect(parseCustom(defs, { multiselect: "5G", email: "nope", url: "javascript:alert(1)" }, null).errors).toHaveLength(3);
  });
});

describe("financial year", () => {
  it("starts in any month", () => {
    expect(fyBounds(2026, 4)).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(fyBounds(2026, 1)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(fyBounds(2026, 7)).toEqual({ from: "2026-07-01", to: "2027-06-30" });
    expect([fyLabel(2026, 4), fyLabel(2026, 1)]).toEqual(["FY 2026–27", "FY 2026"]);
  });
});

describe("two-step sign-in", () => {
  it("is skipped when off, and a code works only once", async () => {
    const [org] = await db.insert(organizations).values({ name: `2FA ${Date.now()}` }).returning();
    const secret = newSecret();
    const [u] = await db
      .insert(users)
      .values({ orgId: org.id, name: "T", email: `totp-${Date.now()}@test.local`, passwordHash: "x", totpSecret: secret, totpEnabled: true })
      .returning();
    const code = codeAt(base32Decode(secret), Math.floor(Date.now() / 30000));
    expect(await passesTwoStep({ ...u, totpEnabled: false }, "")).toBe(true);
    expect(await passesTwoStep(u, "")).toBe(false);
    expect(await passesTwoStep(u, "000000" === code ? "111111" : "000000")).toBe(false);
    expect(await passesTwoStep(u, code)).toBe(true);
    // Replay with stale user data (two sign-ins at once) and with fresh data.
    expect(await passesTwoStep(u, code)).toBe(false);
    const [fresh] = await db.select().from(users).where(eq(users.id, u.id));
    expect(await passesTwoStep(fresh, code)).toBe(false);
  });
});
