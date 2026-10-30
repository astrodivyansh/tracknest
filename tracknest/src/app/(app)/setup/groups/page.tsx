import Link from "next/link";
import { asc, count, eq } from "drizzle-orm";
import { db, withOrg } from "@/db";
import { securityGroups, users } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { ACTION_KEYS, ACTIONS } from "@/lib/permissions";
import { btn, btnSecondary, card, h1, h2, input, label } from "@/lib/ui";
import { addGroup, removeGroup, updateGroup } from "./actions";

function Perms({ checked }: { checked: string[] }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      {ACTION_KEYS.map((a) => (
        <label key={a} className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="perm" value={a} defaultChecked={checked.includes(a)} /> {ACTIONS[a].label}
        </label>
      ))}
    </div>
  );
}

export default async function GroupsPage() {
  const user = await requireUser("admin");
  const groups = await withOrg(user.orgId, (tx) => tx.select().from(securityGroups).orderBy(asc(securityGroups.name)));
  const members = await db
    .select({ groupId: users.groupId, n: count() })
    .from(users)
    .where(eq(users.orgId, user.orgId))
    .groupBy(users.groupId);
  const size = (id: string) => members.find((m) => m.groupId === id)?.n ?? 0;

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>Security groups</h1>
        <p className="text-sm text-muted-foreground">
          Limit what managers can do. A manager in a group can only do what is ticked; managers without a group can do everything. Viewers can never change anything, and admins can always do
          everything. Assign people under{" "}
          <Link href="/team" className="text-primary hover:underline">
            Team
          </Link>
          .
        </p>
      </div>

      {groups.map((g) => (
        <details key={g.id} className={card}>
          <summary className="cursor-pointer text-sm font-medium">
            {g.name} <span className="text-muted-foreground">· {size(g.id)} member{size(g.id) === 1 ? "" : "s"} · {g.permissions.length} of {ACTION_KEYS.length} allowed</span>
          </summary>
          <ActionForm action={updateGroup.bind(null, g.id)} className="mt-4 space-y-3">
            <label className={label}>
              Name
              <input name="name" required defaultValue={g.name} className={input} />
            </label>
            <Perms checked={g.permissions} />
            <button className={btnSecondary}>Save group</button>
          </ActionForm>
          <ActionForm action={removeGroup.bind(null, g.id)} className="mt-3">
            <button className="text-sm text-red-600 hover:underline dark:text-red-400">Remove group</button>
          </ActionForm>
        </details>
      ))}

      <section className={card}>
        <h2 className={h2}>New group</h2>
        <ActionForm action={addGroup} className="mt-3 space-y-3">
          <label className={label}>
            Name
            <input name="name" required placeholder="e.g. Store keepers" className={input} />
          </label>
          <Perms checked={["checkout", "move", "reserve"]} />
          <button className={btn}>Add group</button>
        </ActionForm>
      </section>
    </>
  );
}
