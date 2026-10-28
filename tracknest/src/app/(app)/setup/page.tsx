import { withOrg } from "@/db";
import { ActionForm } from "@/components/action-form";
import { requireUser } from "@/lib/auth";
import { getLookups } from "@/lib/lookups";
import { btn, card, h1, h2, input } from "@/lib/ui";
import { addCategory, addDepartment, addLocation, addSite } from "./actions";

export default async function SetupPage() {
  const user = await requireUser();
  const l = await withOrg(user.orgId, getLookups);
  const isAdmin = user.role === "admin" || user.role === "owner";

  return (
    <>
      <div>
        <h1 className={h1}>Setup</h1>
        <p className="text-sm text-gray-600">Sites, locations, categories and departments used across your assets.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className={card}>
          <h2 className={h2}>Sites and locations</h2>
          <ul className="my-3 space-y-1 text-sm">
            {l.sites.map((s) => (
              <li key={s.id}>
                <span className="font-medium">{s.name}</span>
                <span className="text-gray-500">
                  {" — "}
                  {l.locations.filter((x) => x.siteId === s.id).map((x) => x.name).join(", ") || "no locations yet"}
                </span>
              </li>
            ))}
            {l.sites.length === 0 && <li className="text-gray-500">No sites yet. Add your first office or building.</li>}
          </ul>
          {isAdmin && (
            <div className="space-y-3">
              <ActionForm action={addSite} className="flex gap-2">
                <input name="name" placeholder="New site, e.g. Head Office" required className={input} />
                <button className={btn}>Add site</button>
              </ActionForm>
              {l.sites.length > 0 && (
                <ActionForm action={addLocation} className="flex gap-2">
                  <select name="siteId" required className={input}>
                    {l.sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <input name="name" placeholder="Location, e.g. Floor 2" required className={input} />
                  <button className={btn}>Add</button>
                </ActionForm>
              )}
            </div>
          )}
        </section>

        <SimpleList title="Categories" items={l.categories} action={isAdmin ? addCategory : null} placeholder="e.g. Laptops" />
        <SimpleList title="Departments" items={l.departments} action={isAdmin ? addDepartment : null} placeholder="e.g. Finance" />
      </div>
    </>
  );
}

function SimpleList({
  title,
  items,
  action,
  placeholder,
}: {
  title: string;
  items: { id: string; name: string }[];
  action: typeof addCategory | null;
  placeholder: string;
}) {
  return (
    <section className={card}>
      <h2 className={h2}>{title}</h2>
      <p className="my-3 text-sm text-gray-700">
        {items.map((i) => i.name).join(", ") || <span className="text-gray-500">None yet.</span>}
      </p>
      {action && (
        <ActionForm action={action} className="flex gap-2">
          <input name="name" placeholder={placeholder} required className={input} />
          <button className={btn}>Add</button>
        </ActionForm>
      )}
    </section>
  );
}
