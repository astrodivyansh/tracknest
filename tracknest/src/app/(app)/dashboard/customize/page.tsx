import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { WIDGET_KEYS, WIDGETS, widgetsFor } from "@/lib/dashboard-widgets";
import { btn, btnSecondary, card, h1, input } from "@/lib/ui";
import { resetDashboard, saveDashboard } from "./actions";

export default async function CustomizeDashboard() {
  const user = await requireUser();
  const [me] = await db.select({ dashboard: users.dashboard }).from(users).where(eq(users.id, user.id));
  const shown = widgetsFor(me.dashboard);
  // Shown ones first in their order, then the hidden ones.
  const rows = [...shown, ...WIDGET_KEYS.filter((k) => !shown.includes(k))];

  return (
    <>
      <div>
        <Link href="/dashboard" className="text-sm text-primary hover:underline">
          ← Dashboard
        </Link>
        <h1 className={h1}>Customize my dashboard</h1>
        <p className="text-sm text-muted-foreground">Only changes your own view. Lower positions come first.</p>
      </div>
      <section className={card}>
        <ActionForm action={saveDashboard} className="space-y-3">
          {rows.map((k, i) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <input name={`position_${k}`} type="number" min={1} max={99} defaultValue={i + 1} aria-label={`Position of ${WIDGETS[k]}`} className={`${input} w-20`} />
              <label className="flex items-center gap-2">
                <input type="checkbox" name={`show_${k}`} defaultChecked={shown.includes(k)} /> {WIDGETS[k]}
              </label>
            </div>
          ))}
          <button className={btn}>Save</button>
        </ActionForm>
        <ActionForm action={resetDashboard} className="mt-3">
          <button className={btnSecondary}>Reset to standard</button>
        </ActionForm>
      </section>
    </>
  );
}
