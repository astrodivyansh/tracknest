import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users } from "@/db/schema";

describe("removed team members", () => {
  it("keep their row, and free their email for a new invite", async () => {
    const [org] = await db.insert(organizations).values({ name: `Soft ${Date.now()}` }).returning();
    const email = `gone-${Date.now()}@test.local`;
    const row = { orgId: org.id, name: "Gone", email, passwordHash: "x" };
    const [first] = await db.insert(users).values(row).returning();
    await expect(db.insert(users).values(row)).rejects.toThrow(); // still active: email taken
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, first.id));
    await db.insert(users).values(row);
    expect((await db.select().from(users).where(eq(users.orgId, org.id))).length).toBe(2);
  });
});
