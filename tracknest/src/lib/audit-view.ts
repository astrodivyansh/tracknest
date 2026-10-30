import { asc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Tx } from "@/db";
import { assets, auditItems, locations } from "@/db/schema";

export type AuditGroup = "pending" | "missing" | "misplaced" | "found" | "unexpected";

export const GROUP_LABEL: Record<AuditGroup, string> = {
  pending: "Not scanned yet",
  missing: "Missing",
  misplaced: "Found in the wrong place",
  found: "Found",
  unexpected: "Not expected here",
};

/** Every item of an audit with its asset and both locations, sorted into a result group. */
export async function auditRows(tx: Tx, auditId: string) {
  const expectedLoc = alias(locations, "expected_loc");
  const foundLoc = alias(locations, "found_loc");
  const rows = await tx
    .select({
      assetId: assets.id,
      tag: assets.tag,
      name: assets.name,
      expected: auditItems.expected,
      result: auditItems.result,
      expectedLocationId: auditItems.expectedLocationId,
      foundLocationId: auditItems.foundLocationId,
      expectedLocation: expectedLoc.name,
      foundLocation: foundLoc.name,
      foundAt: auditItems.foundAt,
      foundBy: auditItems.foundBy,
    })
    .from(auditItems)
    .innerJoin(assets, eq(assets.id, auditItems.assetId))
    .leftJoin(expectedLoc, eq(expectedLoc.id, auditItems.expectedLocationId))
    .leftJoin(foundLoc, eq(foundLoc.id, auditItems.foundLocationId))
    .where(eq(auditItems.auditId, auditId))
    .orderBy(asc(assets.tag));
  return rows.map((r) => {
    const group: AuditGroup = !r.expected
      ? "unexpected"
      : r.result === "missing"
        ? "missing"
        : r.result !== "found"
          ? "pending"
          : r.foundLocationId && r.expectedLocationId && r.foundLocationId !== r.expectedLocationId
            ? "misplaced"
            : "found";
    return { ...r, group };
  });
}
