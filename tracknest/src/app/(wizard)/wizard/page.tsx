import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { ArrowRightLeft, Ban, Check, ChevronLeft, ChevronRight, DollarSign, Gift, HandHelping, Recycle, Search, Send, Wrench, type LucideIcon } from "lucide-react";
import { withOrg } from "@/db";
import { categories, customFields, FIELD_TYPES, locations, organizations, sites } from "@/db/schema";
import { addCategory, addCustomField, addSite, removeCustomField, removeItem, renameItem, updateSite } from "@/app/(app)/setup/actions";
import { ActionForm } from "@/components/action-form";
import { CompanyFields, LogoSection } from "@/components/company-fields";
import { FORM_FIELDS, type FormFieldKey } from "@/lib/asset-form-setup";
import { requireUser } from "@/lib/auth";
import { FIELD_TYPE_LABEL } from "@/lib/custom-fields";
import type { FormState } from "@/lib/form";
import { btn, btnSecondary, card, h1, h2, input, label, td, th } from "@/lib/ui";
import { LAST_STEP, STEPS } from "@/lib/wizard";
import { continueStep, saveCompanyStep, saveDatabaseStep, saveSwitchStep } from "./actions";
import { FormDialog } from "./dialog";
import { LocationsStep } from "./locations-step";

const smallEdit = "rounded-md border border-border px-2 py-1 text-xs font-medium text-primary hover:bg-muted/50";
const smallDelete = "rounded-md border border-border px-2 py-1 text-xs font-medium text-red-600 hover:bg-muted/50 dark:text-red-400";
const FORM_ID = "wizard-step";

const FIELD_HELP: Record<FormFieldKey, [string, string]> = {
  categoryId: ["The group the asset belongs to", "Computer equipment"],
  locationId: ["Where the asset lives", "Noida, Floor 2"],
  departmentId: ["The team that uses the asset", "Finance"],
  condition: ["The asset's current state", "Good"],
  brand: ["Manufacturer of the asset", "HP"],
  model: ["Model name of the asset", "Envy"],
  serial: ["Manufacturer's serial number", "HG9C3X"],
  purchaseDate: ["Date the asset was purchased", "22 Aug 2024"],
  cost: ["Cost of the asset", "225.75"],
  purchasedFrom: ["Vendor or supplier name", "Amazon"],
  notes: ["Anything else worth keeping", "Under desk 14"],
};

const TABLE_OPTIONS: { key: string; name: string; help: string }[] = [
  { key: "records", name: "Contracts, insurance and funding", help: "Keep these records and link them to assets." },
  { key: "warranty", name: "Warranties", help: "Track warranty end dates and get reminders." },
  { key: "reserve", name: "Reservations", help: "Book assets for people ahead of time." },
  { key: "move", name: "Moves", help: "Move assets between locations and departments." },
  { key: "link", name: "Linked assets", help: "Link parent and child assets, such as a laptop and its dock." },
];

const EVENT_OPTIONS: { key: string; name: string; help?: string; icon: LucideIcon }[] = [
  { key: "checkout", name: "Check-out assets", help: "Assets are checked out or assigned to people, who you add under People.", icon: HandHelping },
  { key: "lease", name: "Lease assets", help: "Assets are leased, rented or loaned to customers, who you add under Customers.", icon: Send },
  { key: "lost", name: "Lost/Found assets", icon: Search },
  { key: "maintenance", name: "Repair assets", icon: Wrench },
  { key: "broken", name: "Broken assets", icon: Ban },
  { key: "scrap", name: "Dispose assets", icon: Recycle },
  { key: "donate", name: "Donate assets", icon: Gift },
  { key: "sell", name: "Sell assets", icon: DollarSign },
];

// Intl has no list of regions, so test every two-letter code. Dropped: blocs and placeholder codes.
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);
const regionNames = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
const A_TO_Z = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
// A Set because retired codes (DY for Benin, say) repeat their successor's name.
const COUNTRIES = [
  ...new Set(
    A_TO_Z.flatMap((a) => A_TO_Z.map((b) => a + b))
      .filter((code) => !NOT_COUNTRIES.has(code))
      .map((code) => regionNames.of(code))
      .filter((name): name is string => !!name),
  ),
].sort();

function YesNo({ name, on, label: aria }: { name: string; on: boolean; label: string }) {
  return (
    <span role="radiogroup" aria-label={aria} className="flex shrink-0 gap-4 text-sm text-foreground">
      <label className="flex items-center gap-1.5">
        <input type="radio" name={name} value="yes" defaultChecked={on} /> Yes
      </label>
      <label className="flex items-center gap-1.5">
        <input type="radio" name={name} value="no" defaultChecked={!on} /> No
      </label>
    </span>
  );
}

function SiteFields({ site }: { site?: typeof sites.$inferSelect }) {
  const text = (name: "name" | "description" | "address" | "suite" | "city" | "state" | "postalCode", title: string, required = false) => (
    <label className={label}>
      {title}
      {required && <span className="text-red-600"> *</span>}
      <input name={name} required={required} defaultValue={site?.[name] ?? ""} className={input} />
    </label>
  );
  return (
    <>
      {text("name", "Site", true)}
      {text("description", "Description")}
      {text("address", "Address")}
      {text("suite", "Apt. / Suite")}
      {text("city", "City")}
      {text("state", "State")}
      {text("postalCode", "Postal code")}
      <label className={label}>
        Country
        <select name="country" defaultValue={site?.country ?? ""} className={input}>
          <option value="">Select country</option>
          {COUNTRIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
    </>
  );
}

function ListTable({ heading, rows }: { heading: string; rows: { id: string; name: string; edit: React.ReactNode; remove: (s: FormState, f: FormData) => Promise<FormState> }[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            <th className={th}>{heading}</th>
            <th className={`${th} w-16`}>Edit</th>
            <th className={`${th} w-16`}>Delete</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{r.name}</td>
              <td className={td}>{r.edit}</td>
              <td className={td}>
                <ActionForm action={r.remove}>
                  <button className={smallDelete}>Delete</button>
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListHeader({ title, action, importLabel }: { title: string; action: React.ReactNode; importLabel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className={h2}>{title}</h2>
      <div className="flex flex-wrap gap-2">
        {action}
        <Link href="/import" className={btnSecondary}>
          {importLabel}
        </Link>
      </div>
    </div>
  );
}

export default async function WizardPage({ searchParams }: PageProps<"/wizard">) {
  const user = await requireUser("admin");
  const pending = user.setupStep <= LAST_STEP;
  const { step: asked } = await searchParams;
  // Only steps already reached can be opened; a bare /wizard resumes where they left off.
  const step = Math.min(Math.max(Number(asked) || (pending ? user.setupStep : 1), 1), Math.min(user.setupStep, LAST_STEP));
  const data = await withOrg(user.orgId, async (tx) => ({
    org: (await tx.select().from(organizations).where(eq(organizations.id, user.orgId)))[0],
    sites: await tx.select().from(sites).orderBy(asc(sites.name)),
    locations: await tx.select().from(locations).orderBy(asc(locations.name)),
    categories: await tx.select().from(categories).orderBy(asc(categories.name)),
    fields: await tx.select().from(customFields).orderBy(asc(customFields.label)),
  }));
  const { org } = data;
  const off = (key: string) => org.disabledFeatures.includes(key);
  const listStep = step >= 2 && step <= 4;

  return (
    <>
      <h1 className={h1}>
        Step {step} – {STEPS[step - 1]}
      </h1>

      <nav aria-label="Setup steps" className={`${card} overflow-x-auto`}>
        <ol className="flex min-w-max items-start justify-between gap-2">
          {STEPS.map((name, i) => {
            const n = i + 1;
            const done = n < user.setupStep && n !== step;
            const inner = (
              <>
                <span className={`flex size-8 items-center justify-center rounded-full text-sm font-medium ${done ? "bg-green-600 text-white" : n === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  {done ? <Check className="size-4" aria-label="Done" /> : n}
                </span>
                <span className={`max-w-20 text-center text-xs ${n === step ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{name}</span>
              </>
            );
            return (
              <li key={name} aria-current={n === step ? "step" : undefined} className="flex items-start gap-2">
                {n <= user.setupStep ? (
                  <Link href={`/wizard?step=${n}`} className="flex flex-col items-center gap-1 hover:opacity-80">
                    {inner}
                  </Link>
                ) : (
                  <span className="flex flex-col items-center gap-1">{inner}</span>
                )}
                {n < LAST_STEP && <ChevronRight className="mt-2 size-4 text-muted-foreground" aria-hidden />}
              </li>
            );
          })}
        </ol>
      </nav>

      {step === 1 && (
        <>
          <section className={card}>
            <h2 className={h2}>Your company</h2>
            <p className="mb-4 text-sm text-muted-foreground">These details are used across assets, reports and labels. You can change them later under Setup.</p>
            <ActionForm id={FORM_ID} action={saveCompanyStep} className="grid gap-4 sm:grid-cols-3">
              <CompanyFields org={org} />
            </ActionForm>
          </section>
          <LogoSection logoKey={org.logoKey} />
        </>
      )}

      {step === 2 && (
        <section className={`${card} space-y-4`}>
          <ListHeader
            title="List of Sites"
            importLabel="Import Sites"
            action={
              <FormDialog title="Add a Site" intro="Enter the details of your new site and we'll add it to your list." trigger="+ Add New Site" submit="Add" action={addSite}>
                <SiteFields />
              </FormDialog>
            }
          />
          <p className="text-sm text-muted-foreground">A site may be a building or address. Knowing which site each asset is assigned to makes it easy to find and count.</p>
          <ListTable
            heading="Site"
            rows={data.sites.map((s) => ({
              id: s.id,
              name: s.name,
              remove: removeItem.bind(null, "site", s.id),
              edit: (
                <FormDialog title="Edit Site" trigger="Edit" triggerClass={smallEdit} submit="Save" action={updateSite.bind(null, s.id)}>
                  <SiteFields site={s} />
                </FormDialog>
              ),
            }))}
          />
        </section>
      )}

      {step === 3 && (
        <section className={`${card} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={h2}>List of Locations</h2>
            <Link href="/import" className={btnSecondary}>
              Import Locations
            </Link>
          </div>
          <p className="text-sm text-muted-foreground">Locations are a subset of sites. A site may be a building, and a location a specific room, office or floor within it. Select a site and add its locations here.</p>
          <LocationsStep sites={data.sites.map((s) => ({ id: s.id, name: s.name }))} locations={data.locations.map((l) => ({ id: l.id, name: l.name, siteId: l.siteId }))} />
        </section>
      )}

      {step === 4 && (
        <section className={`${card} space-y-4`}>
          <ListHeader
            title="List of Categories"
            importLabel="Import Categories"
            action={
              <FormDialog title="Add a Category" trigger="+ Add New Category" submit="Add" action={addCategory}>
                <label className={label}>
                  Category
                  <input name="name" required className={input} />
                </label>
              </FormDialog>
            }
          />
          <p className="text-sm text-muted-foreground">Categories are how you group your assets. We&apos;ve added some common ones to get you started. Go as broad or as specific as fits how your team tracks things.</p>
          <ListTable
            heading="Category"
            rows={data.categories.map((c) => ({
              id: c.id,
              name: c.name,
              remove: removeItem.bind(null, "category", c.id),
              edit: (
                <FormDialog title="Edit Category" trigger="Edit" triggerClass={smallEdit} submit="Save" action={renameItem.bind(null, "category", c.id)}>
                  <label className={label}>
                    Category
                    <input name="name" required defaultValue={c.name} className={input} />
                  </label>
                </FormDialog>
              ),
            }))}
          />
        </section>
      )}

      {step === 5 && (
        <>
          <section className={`${card} space-y-3`}>
            <h2 className={h2}>Asset Database Fields</h2>
            <p className="text-sm text-muted-foreground">
              Tick the fields you want to include. <strong>Asset Tag ID</strong> and <strong>Asset Description</strong> are always required.
            </p>
            <ActionForm id={FORM_ID} action={saveDatabaseStep}>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className={`${th} w-8`}>
                        <span className="sr-only">Include</span>
                      </th>
                      <th className={th}>Field name</th>
                      <th className={th}>Data required</th>
                      <th className={th}>Description</th>
                      <th className={th}>Example</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[
                      ["Asset Tag ID", "The unique number your company assigns to each asset, usually a sequential label with a barcode.", `${org.tagPrefix}-000001`],
                      ["Asset Description", "Description of the asset", "HP Envy Desktop, 12GB memory"],
                    ].map(([name, help, example]) => (
                      <tr key={name}>
                        <td className={td}>
                          <input type="checkbox" checked disabled aria-label={`${name} is always included`} />
                        </td>
                        <td className={`${td} font-medium whitespace-nowrap`}>{name}</td>
                        <td className={td}>Yes</td>
                        <td className={td}>{help}</td>
                        <td className={`${td} text-muted-foreground`}>{example}</td>
                      </tr>
                    ))}
                    {FORM_FIELDS.map((f) => {
                      const s = org.assetForm[f.key] ?? {};
                      return (
                        <tr key={f.key}>
                          <td className={td}>
                            <input type="checkbox" name={`include_${f.key}`} defaultChecked={!s.hidden} aria-label={`Include ${f.label}`} />
                          </td>
                          <td className={`${td} font-medium whitespace-nowrap`}>{f.label}</td>
                          <td className={td}>
                            <span role="radiogroup" aria-label={`${f.label} required`} className="flex gap-3 whitespace-nowrap">
                              <label className="flex items-center gap-1.5">
                                <input type="radio" name={`required_${f.key}`} value="yes" defaultChecked={!!s.required} /> Yes
                              </label>
                              <label className="flex items-center gap-1.5">
                                <input type="radio" name={`required_${f.key}`} value="optional" defaultChecked={!s.required} /> Optional
                              </label>
                            </span>
                          </td>
                          <td className={td}>{FIELD_HELP[f.key][0]}</td>
                          <td className={`${td} text-muted-foreground`}>{FIELD_HELP[f.key][1]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ActionForm>
          </section>
          <section className={`${card} space-y-3`}>
            <h2 className={h2}>Asset Custom Fields</h2>
            <p className="text-sm text-muted-foreground">Add your own fields to join the standard ones above.</p>
            {data.fields.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data.fields.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-foreground">
                    <span>
                      {f.label} <span className="text-muted-foreground">({FIELD_TYPE_LABEL[f.type]}{f.required ? ", required" : ""})</span>
                    </span>
                    <ActionForm action={removeCustomField.bind(null, f.id)}>
                      <button className={smallDelete}>Delete</button>
                    </ActionForm>
                  </li>
                ))}
              </ul>
            )}
            <FormDialog title="Add Custom Field" trigger="+ Add Custom Field" submit="Add" action={addCustomField}>
              <label className={label}>
                Field name
                <input name="label" required maxLength={60} className={input} />
              </label>
              <label className={label}>
                Type
                <select name="type" required defaultValue="text" className={input}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>
                Options (dropdown or multiple choice only, separated by commas)
                <input name="options" className={input} />
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" name="required" /> Required
              </label>
            </FormDialog>
          </section>
        </>
      )}

      {step === 6 && (
        <section className={`${card} space-y-3`}>
          <h2 className={h2}>Table Options</h2>
          <p className="text-sm text-muted-foreground">Do you want to keep these records for your assets? What you turn off disappears from menus and asset pages. You can change this later under Setup.</p>
          <ActionForm id={FORM_ID} action={saveSwitchStep.bind(null, 6)} className="divide-y divide-border">
            {TABLE_OPTIONS.map((o) => (
              <div key={o.key} className="grid gap-2 py-3 sm:grid-cols-[16rem_auto_1fr] sm:items-center sm:gap-6">
                <span className="text-sm font-medium text-foreground">{o.name}</span>
                <YesNo name={o.key} on={!off(o.key)} label={o.name} />
                <span className="text-xs text-muted-foreground">{o.help}</span>
              </div>
            ))}
          </ActionForm>
        </section>
      )}

      {step === 7 && (
        <section className={`${card} space-y-3`}>
          <h2 className={h2}>Asset-related Events</h2>
          <p className="text-sm text-muted-foreground">Do you want to register these events for the assets?</p>
          <ActionForm id={FORM_ID} action={saveSwitchStep.bind(null, 7)} className="divide-y divide-border">
            {EVENT_OPTIONS.map((o) => (
              <div key={o.key} className="grid gap-2 py-3 sm:grid-cols-[16rem_auto_1fr] sm:items-center sm:gap-6">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <o.icon className="size-4 text-primary" aria-hidden /> {o.name}
                </span>
                <YesNo name={o.key} on={!off(o.key)} label={o.name} />
                {o.help && <span className="text-xs text-muted-foreground">{o.help}</span>}
              </div>
            ))}
          </ActionForm>
        </section>
      )}

      {step === 8 && (
        <section className={`${card} space-y-4`}>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <ArrowRightLeft className="size-4 shrink-0" aria-hidden /> Keep multiple quantities of consumable items, with low and overflow stock alerts, across your locations.
          </p>
          <ActionForm id={FORM_ID} action={saveSwitchStep.bind(null, 8)} className="flex flex-wrap items-center gap-6">
            <span className="text-base font-semibold text-foreground">Enable Inventory:</span>
            {/* Off until chosen on the first pass; afterwards, whatever was saved. */}
            <YesNo name="inventory" on={!pending && !off("inventory")} label="Enable Inventory" />
          </ActionForm>
        </section>
      )}

      <div className="flex items-center justify-between gap-2">
        {step > 1 ? (
          <Link href={`/wizard?step=${step - 1}`} className={btnSecondary}>
            <ChevronLeft className="mr-1 size-4" aria-hidden /> Back
          </Link>
        ) : (
          <span />
        )}
        {listStep ? (
          <ActionForm action={continueStep.bind(null, step)}>
            <button className={btn}>
              Continue <ChevronRight className="ml-1 size-4" aria-hidden />
            </button>
          </ActionForm>
        ) : (
          <button form={FORM_ID} className={btn}>
            {step === LAST_STEP ? "Finish" : "Continue"} <ChevronRight className="ml-1 size-4" aria-hidden />
          </button>
        )}
      </div>
    </>
  );
}
