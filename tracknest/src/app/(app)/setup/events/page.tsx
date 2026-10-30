import Link from "next/link";
import { asc } from "drizzle-orm";
import { withOrg } from "@/db";
import { customEvents } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { ACTION_KEYS, ACTIONS, EVENT_SWITCH_KEYS, EVENT_SWITCHES, featureOn } from "@/lib/permissions";
import { btn, btnSecondary, card, h1, h2, input } from "@/lib/ui";
import { addCustomEvent, removeCustomEvent, saveFeatures } from "./actions";

export default async function EventsPage() {
  const user = await requireUser("admin");
  const events = await withOrg(user.orgId, (tx) => tx.select().from(customEvents).orderBy(asc(customEvents.name)));

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>Events and features</h1>
      </div>

      <section className={card}>
        <h2 className={h2}>Features in use</h2>
        <p className="text-sm text-muted-foreground">Turn off what your organization doesn&apos;t use; it disappears from menus and asset pages for everyone. History is kept.</p>
        <ActionForm action={saveFeatures} className="mt-3 space-y-2">
          {ACTION_KEYS.filter((a) => ACTIONS[a].feature).map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="on" value={a} defaultChecked={featureOn(user, a)} /> {ACTIONS[a].label}
            </label>
          ))}
          {EVENT_SWITCH_KEYS.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="on" value={a} defaultChecked={featureOn(user, a)} /> {EVENT_SWITCHES[a]}
            </label>
          ))}
          <button className={`${btn} mt-2`}>Save</button>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className={h2}>Custom events</h2>
        <p className="text-sm text-muted-foreground">Things you record on an asset with a date and notes, e.g. &ldquo;Calibrated&rdquo; or &ldquo;Safety inspection&rdquo;. They appear in its history.</p>
        <ul className="my-3 space-y-1 text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex items-center gap-3">
              {e.name}
              <ActionForm action={removeCustomEvent.bind(null, e.id)}>
                <button className="text-sm text-red-600 hover:underline dark:text-red-400">Remove</button>
              </ActionForm>
            </li>
          ))}
          {events.length === 0 && <li className="text-muted-foreground">None yet.</li>}
        </ul>
        <ActionForm action={addCustomEvent} className="flex gap-2">
          <input name="name" required maxLength={60} placeholder="e.g. Calibrated" aria-label="New event name" className={input} />
          <button className={btnSecondary}>Add</button>
        </ActionForm>
      </section>
    </>
  );
}
