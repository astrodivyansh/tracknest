import { SUBSCRIPTION_STATES, type subscriptions } from "@/db/schema";
import { input, label } from "@/lib/ui";
import { PERIODS } from "@/lib/subscriptions";

type Sub = typeof subscriptions.$inferSelect;

export const DUE_BADGE = {
  overdue: ["Overdue", "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300"],
  today: ["Due today", "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300"],
  soon: ["Due soon", "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300"],
  ok: ["Active", "bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300"],
  off: ["", "bg-muted text-muted-foreground"],
} as const;

const STATE_LABEL = { active: "Active", paused: "Paused (no reminders)", cancelled: "Cancelled" };

/** Shared by Add and Edit; parsed by the schema in ./actions.ts. */
export function SubscriptionFields({ s, people, currency, today }: { s?: Sub; people: { id: string; name: string }[]; currency: string; today: string }) {
  const isPreset = !s || s.periodMonths in PERIODS;
  return (
    <>
      <label className={label}>
        Software or service
        <input name="name" required defaultValue={s?.name} placeholder="e.g. Microsoft 365" className={input} />
      </label>
      <label className={label}>
        Vendor
        <input name="vendor" defaultValue={s?.vendor ?? ""} className={input} />
      </label>
      <label className={label}>
        Plan
        <input name="plan" defaultValue={s?.plan ?? ""} placeholder="e.g. Business Standard" className={input} />
      </label>
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <label className={label}>
          Billing amount
          <input name="amount" required inputMode="decimal" defaultValue={s?.amount ?? ""} className={input} />
        </label>
        <label className={label}>
          Currency
          <input name="currency" required maxLength={3} defaultValue={s?.currency ?? currency} className={`${input} uppercase`} />
        </label>
      </div>
      <label className={label}>
        Recharged every
        <select name="periodMonths" required defaultValue={s?.periodMonths ?? 12} className={input}>
          {Object.entries(PERIODS).map(([m, name]) => (
            <option key={m} value={m}>
              {name}
            </option>
          ))}
          {!isPreset && <option value={s!.periodMonths}>Every {s!.periodMonths} months</option>}
          {[2, 4, 18, 24, 36].map((m) => (
            <option key={m} value={m}>
              Every {m} months
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        Next recharge date
        <input name="nextDueOn" type="date" required defaultValue={s?.nextDueOn ?? today} className={input} />
      </label>
      <label className={label}>
        Remind this many days before
        <input name="remindDays" type="number" min={0} max={90} defaultValue={s?.remindDays ?? 7} className={input} />
      </label>
      <label className={label}>
        Seats / licences
        <input name="seats" type="number" min={1} defaultValue={s?.seats ?? ""} placeholder="Leave blank if not per seat" className={input} />
      </label>
      <label className={label}>
        Owner (gets the reminder emails)
        <select name="ownerId" defaultValue={s?.ownerId ?? ""} className={input}>
          <option value="">—</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {s && (
        <label className={label}>
          Status
          <select name="state" defaultValue={s.state} className={input}>
            {SUBSCRIPTION_STATES.map((st) => (
              <option key={st} value={st}>
                {STATE_LABEL[st]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={label}>
        Notes
        <input name="notes" defaultValue={s?.notes ?? ""} className={input} />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
        <input type="checkbox" name="autoRenew" defaultChecked={s?.autoRenew} /> Renews automatically (card or auto-debit)
      </label>
    </>
  );
}
