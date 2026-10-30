import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { DATE_FORMATS, organizations } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { DATE_FORMAT_LABEL } from "@/lib/format";
import { btn, btnSecondary, card, h1, h2, input, label } from "@/lib/ui";
import { removeLogo, saveCompany, uploadLogo } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default async function CompanyPage() {
  const user = await requireUser("admin");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId));
  const zones = Intl.supportedValuesOf("timeZone");

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>Company settings</h1>
      </div>

      <section className={card}>
        <ActionForm action={saveCompany} className="grid gap-4 sm:grid-cols-3">
          <label className={label}>
            Organization name
            <input name="name" required defaultValue={org.name} className={input} />
          </label>
          <label className={label}>
            Currency (3-letter code)
            <input name="currency" required defaultValue={org.currency} maxLength={3} className={`${input} uppercase`} />
          </label>
          <label className={label}>
            Timezone
            <select name="timezone" defaultValue={org.timezone} className={input}>
              {(zones.includes(org.timezone) ? zones : [org.timezone, ...zones]).map((z) => (
                <option key={z}>{z}</option>
              ))}
            </select>
          </label>
          <label className={label}>
            Date format
            <select name="dateFormat" defaultValue={org.dateFormat} className={input}>
              {DATE_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {DATE_FORMAT_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Financial year starts in
            <select name="fyStartMonth" defaultValue={org.fyStartMonth} className={input}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            Asset tag prefix
            <input name="tagPrefix" required defaultValue={org.tagPrefix} maxLength={8} className={`${input} uppercase`} />
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The prefix applies to new tags only (e.g. {org.tagPrefix}-{String(org.nextTagSeq).padStart(6, "0")}). The financial year is used by the dashboard and the depreciation schedule.
          </p>
          <div className="sm:text-right">
            <button className={btn}>Save</button>
          </div>
        </ActionForm>
      </section>

      <section className={card}>
        <h2 className={h2}>Logo</h2>
        <p className="text-sm text-muted-foreground">Shown in the menu and on printed reports. JPEG, PNG or WebP, up to 1 MB.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {org.logoKey && (
            // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file
            <img src={`/logo?v=${org.logoKey.slice(-8)}`} alt="Current logo" className="h-12 max-w-48 rounded bg-white object-contain p-1" />
          )}
          <ActionForm action={uploadLogo} className="flex flex-wrap items-center gap-2">
            <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
            <button className={btnSecondary}>Upload</button>
          </ActionForm>
          {org.logoKey && (
            <ActionForm action={removeLogo}>
              <button className="text-sm text-red-600 hover:underline dark:text-red-400">Remove logo</button>
            </ActionForm>
          )}
        </div>
      </section>
    </>
  );
}
