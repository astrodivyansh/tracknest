import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { alertSettings } from "@/lib/alerts";
import { requireUser } from "@/lib/auth";
import { templatesFor } from "@/lib/event-mail";
import { btn, btnSecondary, card, h1, h2, input, label } from "@/lib/ui";
import { saveAlertSettings, saveTemplate } from "./actions";

const PLACEHOLDERS = ["tag", "name", "holder", "due", "details", "by", "date", "link", "org"];

export default async function AlertSettingsPage() {
  const user = await requireUser("admin");
  const [org] = await db.select({ settings: organizations.alertSettings }).from(organizations).where(eq(organizations.id, user.orgId));
  const s = alertSettings(org.settings);
  const templates = await templatesFor(user.orgId);
  const box = "flex items-center gap-2 text-sm text-foreground";

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>Alerts and emails</h1>
        <p className="text-sm text-muted-foreground">The daily summary goes to managers who have email alerts on (My account). Emails are sent once, after 8am in your timezone.</p>
      </div>

      <section className={card}>
        <h2 className={h2}>Daily alerts</h2>
        <ActionForm action={saveAlertSettings} className="mt-3 grid gap-3 sm:grid-cols-4 sm:items-end">
          <label className={label}>
            Maintenance due within (days)
            <input name="maintenanceDays" type="number" min={1} max={365} required defaultValue={s.maintenanceDays} className={input} />
          </label>
          <label className={label}>
            Warranties ending within (days)
            <input name="warrantyDays" type="number" min={1} max={365} required defaultValue={s.warrantyDays} className={input} />
          </label>
          <label className={`${box} sm:col-span-1`}>
            <input type="checkbox" name="holderReminders" defaultChecked={s.holderReminders} /> Remind holders when an asset is due today or overdue
          </label>
          <button className={btn}>Save</button>
        </ActionForm>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className={h2}>Emails when something happens</h2>
          <p className="text-sm text-muted-foreground">
            Sent straight after the action. &ldquo;The holder&rdquo; is the person or customer, if they have an email. Placeholders:{" "}
            {PLACEHOLDERS.map((p) => (
              <code key={p} className="mr-1 rounded bg-muted px-1 text-xs">{`{${p}}`}</code>
            ))}
          </p>
        </div>
        {templates.map((t) => (
          <details key={t.event} className={card}>
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              {t.label}
              <span className={`rounded px-1.5 py-0.5 text-xs ${t.enabled ? "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>
                {t.enabled ? "On" : "Off"}
              </span>
            </summary>
            <ActionForm action={saveTemplate.bind(null, t.event)} className="mt-4 grid gap-3">
              <div className="flex flex-wrap gap-4">
                <label className={box}>
                  <input type="checkbox" name="enabled" defaultChecked={t.enabled} /> Send this email
                </label>
                <label className={box}>
                  <input type="checkbox" name="toHolder" defaultChecked={t.toHolder} /> To the holder
                </label>
                <label className={box}>
                  <input type="checkbox" name="toManagers" defaultChecked={t.toManagers} /> To managers with alerts on
                </label>
              </div>
              <label className={label}>
                Subject
                <input name="subject" required defaultValue={t.subject} className={input} />
              </label>
              <label className={label}>
                Message
                <textarea name="body" required rows={7} defaultValue={t.body} className={`${input} font-mono text-xs`} />
              </label>
              <div>
                <button className={btnSecondary}>Save</button>
              </div>
            </ActionForm>
          </details>
        ))}
      </section>
    </>
  );
}
