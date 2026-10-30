import { ROLES } from "@/db/schema";
import type { CurrentUser } from "./auth";
import type { BulkKind } from "./labels";
import { CustodyError } from "./custody";

/**
 * What managers can do, one key per action. `feature` ones can also be switched off for the whole
 * org (Setup → Events); a security group lists the keys its members keep.
 */
export const ACTIONS = {
  add: { label: "Add, duplicate and import assets", feature: false },
  edit: { label: "Edit assets, photos, documents and custom events", feature: false },
  checkout: { label: "Check out and check in", feature: true },
  lease: { label: "Lease to customers", feature: true },
  move: { label: "Move between locations and departments", feature: true },
  reserve: { label: "Reservations", feature: true },
  maintenance: { label: "Maintenance", feature: true },
  dispose: { label: "Dispose and change status (broken, lost…)", feature: true },
  link: { label: "Link assets (parent and child)", feature: true },
  warranty: { label: "Warranties", feature: true },
  inventory: { label: "Inventory (consumable stock)", feature: true },
  records: { label: "Contracts, insurance and funding", feature: true },
  people: { label: "Add and edit people and customers", feature: false },
} as const;
export type Action = keyof typeof ACTIONS;
export const ACTION_KEYS = Object.keys(ACTIONS) as Action[];

/** Whether the org has this feature on (for showing a menu item to everyone, viewers included). */
export const featureOn = (u: Pick<CurrentUser, "disabled">, a: Action) => !u.disabled.includes(a);

/** Manager or above, the feature is on, and (for managers) their security group, if any, allows it. */
export const can = (u: Pick<CurrentUser, "role" | "disabled" | "perms">, a: Action) => {
  const rank = ROLES.indexOf(u.role);
  if (rank < ROLES.indexOf("manager") || !featureOn(u, a)) return false;
  return rank >= ROLES.indexOf("admin") || u.perms === null || u.perms.includes(a); // groups only narrow managers
};

/** For server actions: throws a message the form shows. */
export function allow(u: CurrentUser, a: Action) {
  if (!featureOn(u, a)) throw new CustodyError(`${ACTIONS[a].label} is turned off for your organization.`);
  if (!can(u, a)) throw new CustodyError(`You don't have permission for: ${ACTIONS[a].label.toLowerCase()}.`);
  return u;
}

/** The permission each bulk action needs (app/(app)/assets/bulk). */
export const BULK_ACTION: Record<BulkKind, Action> = { checkout: "checkout", checkin: "checkout", move: "move", maintenance: "maintenance", reserve: "reserve", dispose: "dispose" };
