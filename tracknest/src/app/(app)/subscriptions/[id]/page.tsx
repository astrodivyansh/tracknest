import Link from "next/link";
import { notFound } from "next/navigation";
import bwipjs from "bwip-js/node";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { withOrg } from "@/db";
import { assets, persons, subscriptionLinks, subscriptionPayments, subscriptions } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { PrintButton } from "@/components/print-button";
import { appOrigin, requireUser } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtMoney, isoDateIn } from "@/lib/format";
import { can } from "@/lib/permissions";
import { dueState, monthlyCost, periodLabel } from "@/lib/subscriptions";
import { btn, btnSecondary, card, h1, h2, input, label, td, th } from "@/lib/ui";
import { linkAction, rechargeAction, unlinkAction, updateSubscription } from "../actions";
import { DUE_BADGE, SubscriptionFields } from "../subscription-fields";

export default async function SubscriptionPage({ params }: PageProps<"/subscriptions/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withOrg(user.orgId, async (tx) => {
    const [row] = await tx
      .select({ s: subscriptions, owner: persons.name, ownerEmail: persons.email })
      .from(subscriptions)
      .leftJoin(persons, eq(persons.id, subscriptions.ownerId))
      .where(eq(subscriptions.id, id));
    if (!row) return null;
    return {
      ...row,
      payments: await tx.select().from(subscriptionPayments).where(eq(subscriptionPayments.subscriptionId, id)).orderBy(desc(subscriptionPayments.paidOn), desc(subscriptionPayments.recordedAt)),
      links: await tx
        .select({ id: subscriptionLinks.id, assetId: assets.id, tag: assets.tag, assetName: assets.name, personId: persons.id, person: persons.name })
        .from(subscriptionLinks)
        .leftJoin(assets, eq(assets.id, subscriptionLinks.assetId))
        .leftJoin(persons, eq(persons.id, subscriptionLinks.personId))
        .where(eq(subscriptionLinks.subscriptionId, id))
        .orderBy(asc(assets.tag), asc(persons.name)),
      people: await tx.select({ id: persons.id, name: persons.name }).from(persons).where(isNull(persons.deletedAt)).orderBy(asc(persons.name)),
    };
  });
  if (!data) notFound();
  const { s, payments, links, people } = data;
  const editable = can(user, "records");
  const today = isoDateIn(new Date(), user.timezone);
  const due = dueState(s, today);
  const seatsUsed = links.filter((l) => l.personId).length;
  const origin = await appOrigin();
  const qr = bwipjs.toSVG({ bcid: "qrcode", text: `${origin}/a/${encodeURIComponent(s.tag)}`, scale: 3 });

  const facts: [string, React.ReactNode][] = [
    ["Billing", `${fmtMoney(s.amount, s.currency)} · ${periodLabel(s.periodMonths)}`],
    ["Works out to", `${fmtMoney(monthlyCost(s.amount, s.periodMonths), s.currency)} a month · ${fmtMoney(monthlyCost(s.amount, s.periodMonths) * 12, s.currency)} a year`],
    ["Next recharge", s.state === "cancelled" ? "—" : fmtDate(s.nextDueOn, "UTC")],
    ["Renewal", s.autoRenew ? "Automatic (card or auto-debit)" : "Manual recharge"],
    ["Reminder", s.state === "active" ? `${s.remindDays} day${s.remindDays === 1 ? "" : "s"} before, on the day, then weekly if overdue` : "Off while not active"],
    ["Owner", data.owner ? `${data.owner}${data.ownerEmail ? "" : " (no email on file, so only managers are reminded)"}` : "— (managers are reminded in the daily summary)"],
    ["Seats", s.seats ? `${seatsUsed} of ${s.seats} assigned` : seatsUsed ? `${seatsUsed} people` : "—"],
    ["Vendor / plan", [s.vendor, s.plan].filter(Boolean).join(" · ") || "—"],
    ["Notes", s.notes ?? "—"],
  ];

  return (
    <>
      <div>
        <Link href="/subscriptions" className="text-sm text-primary hover:underline print:hidden">
          ← Software subscriptions
        </Link>
        <p className="font-mono text-sm text-muted-foreground">{s.tag}</p>
        <h1 className={h1}>{s.name}</h1>
        <span className={`mt-1 inline-block rounded px-2 py-0.5 text-xs ${DUE_BADGE[due][1]}`}>
          {due === "off" ? (s.state === "paused" ? "Paused" : "Cancelled") : DUE_BADGE[due][0]}
        </span>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <section className={card}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
                <dd className="text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className={`${card} flex flex-col items-center gap-2 text-center`}>
          <div className="w-36 rounded-md bg-white p-2" dangerouslySetInnerHTML={{ __html: qr }} role="img" aria-label={`QR code for ${s.tag}`} />
          <p className="font-mono text-sm font-semibold">{s.tag}</p>
          <p className="max-w-40 text-xs text-muted-foreground">{s.name}</p>
          <div className="print:hidden">
            <PrintButton />
          </div>
        </section>
      </div>

      {editable && s.state !== "cancelled" && (
        <section className={`${card} print:hidden`}>
          <h2 className={h2}>Mark as recharged</h2>
          <p className="text-sm text-muted-foreground">
            Records the payment for the period due {fmtDate(s.nextDueOn, "UTC")} and moves the next recharge to one period later.
          </p>
          <ActionForm action={rechargeAction.bind(null, s.id)} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <input type="hidden" name="forDue" value={s.nextDueOn} />
            <label className={label}>
              Paid on
              <input name="paidOn" type="date" required max={today} defaultValue={today} className={input} />
            </label>
            <label className={label}>
              Amount paid ({s.currency})
              <input name="amount" inputMode="decimal" defaultValue={s.amount} className={input} />
            </label>
            <label className={label}>
              Invoice or order number
              <input name="reference" className={input} />
            </label>
            <label className={label}>
              Invoice (PDF or image, optional)
              <input type="file" name="invoice" accept="application/pdf,image/png,image/jpeg,image/webp" className="text-sm" />
            </label>
            <label className={label}>
              Notes
              <input name="notes" className={input} />
            </label>
            <button className={btn}>Record recharge</button>
          </ActionForm>
        </section>
      )}

      <section className="space-y-2">
        <h2 className={h2}>Recharge history ({payments.length})</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>Paid on</th>
                <th className={th}>Period covered</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Invoice</th>
                <th className={th}>Recorded by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className={`${td} whitespace-nowrap`}>{fmtDate(p.paidOn, "UTC")}</td>
                  <td className={`${td} whitespace-nowrap`}>
                    {fmtDate(p.periodFrom, "UTC")} – {fmtDate(p.periodTo, "UTC")}
                  </td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    {fmtMoney(p.amount, p.currency)}
                    {Number(p.amount) !== Number(s.amount) && p.currency === s.currency && <span className="ml-1 text-xs text-muted-foreground">(billing now {fmtMoney(s.amount, s.currency)})</span>}
                  </td>
                  <td className={td}>
                    {p.reference}
                    {p.invoiceKey && (
                      <a href={`/subscriptions/invoice/${p.id}`} target="_blank" rel="noreferrer" className="ml-2 text-primary hover:underline">
                        {p.invoiceName}
                      </a>
                    )}
                    {!p.reference && !p.invoiceKey && "—"}
                    {p.notes && <span className="block text-xs text-muted-foreground">{p.notes}</span>}
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                    {p.actorName} · {fmtDateTime(p.recordedAt, user.timezone)}
                  </td>
                </tr>
              ))}
              {payments.length === 0 && (
                <tr>
                  <td colSpan={5} className={`${td} text-muted-foreground`}>
                    No recharges recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${card} print:hidden`}>
        <h2 className={h2}>Used by</h2>
        <p className="text-sm text-muted-foreground">Assets that run it, and people who hold a seat.</p>
        <ul className="mt-2 space-y-1 text-sm">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2">
              {l.assetId ? (
                <>
                  <Link href={`/assets/${l.assetId}`} className="font-mono text-primary hover:underline">
                    {l.tag}
                  </Link>
                  {l.assetName}
                </>
              ) : (
                <Link href={`/people/${l.personId}`} className="text-primary hover:underline">
                  {l.person}
                </Link>
              )}
              {editable && (
                <ActionForm action={unlinkAction.bind(null, s.id, l.id)}>
                  <button className="text-sm text-red-600 hover:underline dark:text-red-400">Remove</button>
                </ActionForm>
              )}
            </li>
          ))}
          {links.length === 0 && <li className="text-muted-foreground">Nothing linked yet.</li>}
        </ul>
        {editable && (
          <ActionForm action={linkAction.bind(null, s.id)} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <label className={label}>
              Asset tags
              <input name="tags" placeholder="TN-000001, TN-000002" className={input} />
            </label>
            <label className={label}>
              Person (takes a seat)
              <select name="personId" defaultValue="" className={input}>
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button className={btnSecondary}>Link</button>
          </ActionForm>
        )}
      </section>

      {editable && (
        <details className={`${card} print:hidden`}>
          <summary className="cursor-pointer text-sm font-medium text-primary">Edit details</summary>
          <p className="mt-2 text-sm text-muted-foreground">To stop it, set the status to Cancelled. Its recharge history is kept.</p>
          <ActionForm action={updateSubscription.bind(null, s.id)} className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end">
            <SubscriptionFields s={s} people={people} currency={user.currency} today={today} />
            <button className={btnSecondary}>Save</button>
          </ActionForm>
        </details>
      )}
    </>
  );
}
