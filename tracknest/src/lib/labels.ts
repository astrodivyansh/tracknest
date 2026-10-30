// Kept apart from custody.ts so format.ts can use it without an import cycle.
export const STATUS_LABEL: Record<string, string> = {
  available: "Available",
  checked_out: "Checked out",
  under_maintenance: "Under maintenance",
  lost: "Lost / missing",
  broken: "Broken",
  disposed: "Disposed",
};

/** Actions offered on assets selected in the list (app/(app)/assets/bulk). */
export const BULK = {
  checkout: "Check out",
  checkin: "Check in",
  move: "Move",
  maintenance: "Schedule maintenance",
  reserve: "Reserve",
  dispose: "Dispose",
} as const;
export type BulkKind = keyof typeof BULK;
