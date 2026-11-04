import Link from "next/link";
import { asc } from "drizzle-orm";
import { withOrg } from "@/db";
import { categories } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { isAdmin as isAdminUser, requireUser } from "@/lib/auth";
import { FIELD_TYPE_LABEL, HAS_OPTIONS } from "@/lib/custom-fields";
import { DEP_LABEL } from "@/lib/depreciation";
import { prefixFrom } from "@/lib/custody";
import { getLookups } from "@/lib/lookups";
import { btn, btnSecondary, card, h1, h2, input, label, td, th } from "@/lib/ui";
import {
  addCategory,
  setTagPrefix,
  addDepartment,
  addLocation,
  addCustomField,
  addSite,
  removeCustomField,
  removeItem,
  setFieldReminder,
  updateCustomField,
  renameItem,
  setDepreciationRule,
  type SetupKind,
} from "./actions";

export default async function SetupPage() {
  const user = await requireUser();
  const { l, rules } = await withOrg(user.orgId, async (tx) => ({
    l: await getLookups(tx),
    rules: await tx.select().from(categories).orderBy(asc(categories.name)),
  }));
  const isAdmin = isAdminUser(user);

  return (
    <>
      <div>
        <h1 className={h1}>Setup</h1>
        <p className="text-sm text-muted-foreground">
          Sites, locations, categories and departments used across your assets.
          {isAdmin && " Click a name to rename or remove it. Only unused items can be removed."}
        </p>
        {isAdmin && (
          <Link href="/setup/alerts" className="text-sm text-primary hover:underline">
            Alerts and emails →
          </Link>
        )}
        {isAdmin && (
          <span className="ml-4 space-x-4 text-sm">
            <Link href="/wizard" className="text-primary hover:underline">
              Setup wizard →
            </Link>
            <Link href="/setup/company" className="text-primary hover:underline">
              Company settings →
            </Link>
            <Link href="/setup/asset-form" className="text-primary hover:underline">
              Asset form designer →
            </Link>
            <Link href="/setup/events" className="text-primary hover:underline">
              Events and features →
            </Link>
            <Link href="/setup/groups" className="text-primary hover:underline">
              Security groups →
            </Link>
          </span>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <h2 className={h2}>Sites and locations</h2>
          <ul className="my-3 space-y-2 text-sm">
            {l.sites.map((s) => (
              <li key={s.id}>
                <Item kind="site" id={s.id} name={s.name} editable={isAdmin} bold />
                <ul className="ml-4 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {l.locations
                    .filter((x) => x.siteId === s.id)
                    .map((x) => (
                      <li key={x.id}>
                        <Item kind="location" id={x.id} name={x.name} editable={isAdmin} />
                      </li>
                    ))}
                </ul>
              </li>
            ))}
            {l.sites.length === 0 && <li className="text-muted-foreground">No sites yet. Add your first office or building.</li>}
          </ul>
          {isAdmin && (
            <div className="space-y-3">
              <ActionForm action={addSite} className="flex gap-2">
                <input name="name" placeholder="New site, e.g. Head Office" required aria-label="New site name" className={input} />
                <button className={btn}>Add site</button>
              </ActionForm>
              {l.sites.length > 0 && (
                <ActionForm action={addLocation} className="flex gap-2">
                  <select name="siteId" required aria-label="Site" className={input}>
                    {l.sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input name="name" placeholder="Location, e.g. Floor 2" required aria-label="New location name" className={input} />
                  <button className={btn}>Add</button>
                </ActionForm>
              )}
            </div>
          )}
        </section>

        <SimpleList
          title="Categories"
          kind="category"
          items={l.categories.map((c) => ({ id: c.id, name: c.name, value: c.own }))}
          parents={l.categories.filter((c) => !c.parentId)}
          action={isAdmin ? addCategory : null}
          placeholder="e.g. Laptops"
        />
        <SimpleList title="Departments" kind="department" items={l.departments} action={isAdmin ? addDepartment : null} placeholder="e.g. Finance" />
      </div>

      <section className="space-y-2">
        <h2 className={h2}>Custom asset fields</h2>
        <p className="text-sm text-muted-foreground">Extra details to record on assets, e.g. warranty expiry, IMEI or insurance policy number.</p>
        {l.customFields.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className={th}>Field</th>
                  <th className={th}>Type</th>
                  <th className={th}>Used for</th>
                  {isAdmin && <th className={th} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {l.customFields.map((f) => (
                  <tr key={f.id}>
                    <td className={td}>
                      {f.label}
                      {f.required && <span className="ml-1 text-xs text-muted-foreground">(required)</span>}
                      {f.type === "date" && isAdmin && (
                        <ActionForm action={setFieldReminder.bind(null, f.id)} className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                          Remind
                          <input
                            name="remindDays"
                            inputMode="numeric"
                            defaultValue={f.remindDays ?? ""}
                            placeholder="off"
                            aria-label={`Days before ${f.label} to remind`}
                            className="w-14 rounded border border-input px-1 py-0.5"
                          />
                          days before
                          <button className="text-primary hover:underline">Save</button>
                        </ActionForm>
                      )}
                    </td>
                    <td className={td}>
                      {FIELD_TYPE_LABEL[f.type]}
                      {HAS_OPTIONS.includes(f.type) && <span className="text-xs text-muted-foreground"> · {f.options.join(", ")}</span>}
                    </td>
                    <td className={td}>{l.categories.find((c) => c.id === f.categoryId)?.name ?? "All assets"}</td>
                    {isAdmin && (
                      <td className={`${td} space-y-1`}>
                        <details>
                          <summary className="cursor-pointer text-sm text-primary">Edit</summary>
                          <ActionForm action={updateCustomField.bind(null, f.id)} className="mt-2 grid w-72 gap-2">
                            <input name="label" required defaultValue={f.label} aria-label="Field name" className={input} />
                            {HAS_OPTIONS.includes(f.type) && (
                              <input name="options" defaultValue={f.options.join(", ")} aria-label="Dropdown options, comma-separated" className={input} />
                            )}
                            <button className={btnSecondary}>Save field</button>
                          </ActionForm>
                        </details>
                        <ActionForm action={removeCustomField.bind(null, f.id)}>
                          <button className="text-sm text-red-600 dark:text-red-400 hover:underline">Remove</button>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isAdmin && (
          <ActionForm action={addCustomField} className={`${card} grid gap-3 sm:grid-cols-6 sm:items-end`}>
            <label className={`${label} sm:col-span-2`}>
              Field name
              <input name="label" required placeholder="e.g. Warranty expiry" className={input} />
            </label>
            <label className={label}>
              Type
              <select name="type" defaultValue="text" className={input}>
                {Object.entries(FIELD_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              Used for
              <select name="categoryId" defaultValue="" className={input}>
                <option value="">All assets</option>
                {l.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} only
                  </option>
                ))}
              </select>
            </label>
            <label className={`${label} sm:col-span-2`}>
              Dropdown options
              <input name="options" placeholder="Comma-separated, e.g. Windows, macOS" className={input} />
            </label>
            <label className={`${label} sm:col-span-2`}>
              Remind before (date fields)
              <input name="remindDays" inputMode="numeric" placeholder="Days, e.g. 30" className={input} />
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input type="checkbox" name="required" /> Required
            </label>
            <button className={`${btn} sm:col-start-6`}>Add field</button>
          </ActionForm>
        )}
      </section>

      {rules.length > 0 && (
        <section className="space-y-2">
          <h2 className={h2}>Tag prefix and depreciation by category</h2>
          <p className="text-sm text-muted-foreground">
            New asset tags use the category&apos;s prefix and the next free number, e.g. DESK-000001. Book value is worked out from each asset&apos;s purchase date and cost. Straight-line suits the Companies Act; declining
            balance (WDV) suits income-tax rates, e.g. 40% a year for computers.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/50">
                <tr>
                  <th className={th}>Category</th>
                  <th className={th}>Tag prefix</th>
                  <th className={th}>Rule</th>
                  {isAdmin && <th className={th} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rules.map((c) => (
                  <tr key={c.id} className="align-top">
                    <td className={td}>{c.name}</td>
                    <td className={td}>
                      {isAdmin ? (
                        <ActionForm action={setTagPrefix.bind(null, c.id)} className="flex w-44 gap-2">
                          <input name="tagPrefix" defaultValue={c.tagPrefix ?? ""} placeholder={prefixFrom(c.name) || "—"} maxLength={8} aria-label={`Tag prefix for ${c.name}`} className={`${input} uppercase`} />
                          <button className={btnSecondary}>Save</button>
                        </ActionForm>
                      ) : (
                        c.tagPrefix || prefixFrom(c.name)
                      )}
                    </td>
                    <td className={td}>
                      {[
                        DEP_LABEL[c.depMethod],
                        c.depLifeYears && `${Number(c.depLifeYears)} years`,
                        c.depRatePct && `${Number(c.depRatePct)}% a year`,
                        c.depSalvagePct && Number(c.depSalvagePct) > 0 && `salvage ${Number(c.depSalvagePct)}%`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    {isAdmin && (
                      <td className={td}>
                        <details>
                          <summary className="cursor-pointer text-sm text-primary">Change</summary>
                          <ActionForm action={setDepreciationRule.bind(null, c.id)} className="mt-2 grid w-80 gap-2">
                            <label className={label}>
                              Method
                              <select name="depMethod" defaultValue={c.depMethod} className={input}>
                                {Object.entries(DEP_LABEL).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className={label}>
                              Useful life, years (straight-line, double declining, sum of years)
                              <input name="depLifeYears" inputMode="decimal" defaultValue={c.depLifeYears ? Number(c.depLifeYears) : ""} className={input} />
                            </label>
                            <label className={label}>
                              Rate, % a year (declining balance)
                              <input name="depRatePct" inputMode="decimal" defaultValue={c.depRatePct ? Number(c.depRatePct) : ""} className={input} />
                            </label>
                            <label className={label}>
                              Salvage value, % of cost
                              <input name="depSalvagePct" inputMode="decimal" defaultValue={c.depSalvagePct ? Number(c.depSalvagePct) : ""} placeholder="e.g. 5" className={input} />
                            </label>
                            <button className={btn}>Save rule</button>
                          </ActionForm>
                        </details>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// Locations and departments have their own custody pages.
const PAGE: Partial<Record<SetupKind, string>> = { location: "/locations", department: "/departments" };

/** A name that admins can expand to rename or remove; locations and departments link to their page. */
function Item({
  kind,
  id,
  name,
  value = name,
  editable,
  bold,
}: {
  kind: SetupKind;
  id: string;
  name: string;
  value?: string; // what the rename box starts with, when the shown name has a prefix
  editable: boolean;
  bold?: boolean;
}) {
  const href = PAGE[kind] && `${PAGE[kind]}/${id}`;
  if (!editable)
    return href ? (
      <Link href={href} className="text-primary hover:underline">
        {name}
      </Link>
    ) : (
      <span className={bold ? "font-medium" : ""}>{name}</span>
    );
  return (
    <details className="inline-block align-top">
      <summary className={`cursor-pointer list-none underline decoration-border decoration-dotted underline-offset-4 hover:text-primary ${bold ? "font-medium" : ""}`}>{name}</summary>
      <div className="mt-2 w-72 space-y-2 rounded-md border border-border bg-card p-3 shadow-sm">
        <ActionForm action={renameItem.bind(null, kind, id)} className="flex gap-2">
          <input name="name" defaultValue={value} required aria-label={`New name for ${name}`} className={input} />
          <button className={btnSecondary}>Rename</button>
        </ActionForm>
        <ActionForm action={removeItem.bind(null, kind, id)}>
          <button className="text-sm text-red-600 dark:text-red-400 hover:underline">Remove {name}</button>
        </ActionForm>
        {href && (
          <Link href={href} className="block text-sm text-primary hover:underline">
            Assets and history →
          </Link>
        )}
      </div>
    </details>
  );
}

function SimpleList({
  title,
  kind,
  items,
  parents,
  action,
  placeholder,
}: {
  title: string;
  kind: SetupKind;
  items: { id: string; name: string; value?: string }[];
  parents?: { id: string; name: string }[]; // offer "sub-category of"

  action: typeof addCategory | null;
  placeholder: string;
}) {
  return (
    <section className={card}>
      <h2 className={h2}>{title}</h2>
      <ul className="my-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground">
        {items.map((i) => (
          <li key={i.id}>
            <Item kind={kind} id={i.id} name={i.name} value={i.value} editable={!!action} />
          </li>
        ))}
        {items.length === 0 && <li className="text-muted-foreground">None yet.</li>}
      </ul>
      {action && (
        <ActionForm action={action} className="flex flex-wrap gap-2 sm:flex-nowrap">
          <input name="name" placeholder={placeholder} required aria-label={`New ${kind} name`} className={input} />
          {parents && parents.length > 0 && (
            <select name="parentId" defaultValue="" aria-label="Sub-category of" className={input}>
              <option value="">Top level</option>
              {parents.map((p) => (
                <option key={p.id} value={p.id}>
                  Under {p.name}
                </option>
              ))}
            </select>
          )}
          <button className={btn}>Add</button>
        </ActionForm>
      )}
    </section>
  );
}
