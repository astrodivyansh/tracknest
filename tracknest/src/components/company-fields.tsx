import { DATE_FORMATS, type organizations } from "@/db/schema";
import { removeLogo, uploadLogo } from "@/app/(app)/setup/company/actions";
import { ActionForm } from "@/components/action-form";
import { DATE_FORMAT_LABEL } from "@/lib/format";
import { btnSecondary, card, h2, input, label } from "@/lib/ui";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Shared by Setup → Company and step 1 of the wizard. Goes inside a form that posts to saveCompany. */
export function CompanyFields({ org }: { org: typeof organizations.$inferSelect }) {
  const zones = Intl.supportedValuesOf("timeZone");
  return (
    <>
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
    </>
  );
}

export function LogoSection({ logoKey }: { logoKey: string | null }) {
  return (
    <section className={card}>
      <h2 className={h2}>Logo</h2>
      <p className="text-sm text-muted-foreground">Shown in the menu and on printed reports. JPEG, PNG or WebP, up to 1 MB.</p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        {logoKey && (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file
          <img src={`/logo?v=${logoKey.slice(-8)}`} alt="Current logo" className="h-12 max-w-48 rounded bg-white object-contain p-1" />
        )}
        <ActionForm action={uploadLogo} className="flex flex-wrap items-center gap-2">
          <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
          <button className={btnSecondary}>Upload</button>
        </ActionForm>
        {logoKey && (
          <ActionForm action={removeLogo}>
            <button className="text-sm text-red-600 hover:underline dark:text-red-400">Remove logo</button>
          </ActionForm>
        )}
      </div>
    </section>
  );
}
