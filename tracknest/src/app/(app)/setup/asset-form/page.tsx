import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { FORM_FIELDS } from "@/lib/asset-form-setup";
import { requireUser } from "@/lib/auth";
import { btn, h1, input, td, th } from "@/lib/ui";
import { saveAssetForm } from "./actions";

export default async function AssetFormSetupPage() {
  const user = await requireUser("admin");
  const [org] = await db.select({ setup: organizations.assetForm }).from(organizations).where(eq(organizations.id, user.orgId));

  return (
    <>
      <div>
        <Link href="/setup" className="text-sm text-primary hover:underline">
          ← Setup
        </Link>
        <h1 className={h1}>Asset form designer</h1>
        <p className="text-sm text-muted-foreground">
          Choose what the add and edit asset forms ask for. Name and tag are always shown. Hiding a field keeps any values already saved. Custom fields are managed on{" "}
          <Link href="/setup" className="text-primary hover:underline">
            Setup
          </Link>{" "}
          and appear after these. Imports and the API don&apos;t apply these rules.
        </p>
      </div>
      <ActionForm action={saveAssetForm} className="space-y-3">
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/50">
              <tr>
                <th className={th}>Field</th>
                <th className={th}>Label on the form</th>
                <th className={th}>Position</th>
                <th className={th}>Required</th>
                <th className={th}>Hidden</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {FORM_FIELDS.map((f, i) => {
                const s = org.setup[f.key] ?? {};
                return (
                  <tr key={f.key}>
                    <td className={td}>{f.label}</td>
                    <td className={td}>
                      <input name={`label_${f.key}`} defaultValue={s.label ?? f.label} maxLength={60} aria-label={`Label for ${f.label}`} className={input} />
                    </td>
                    <td className={td}>
                      <input name={`position_${f.key}`} type="number" min={1} max={99} defaultValue={s.position ?? i + 1} aria-label={`Position of ${f.label}`} className={`${input} w-20`} />
                    </td>
                    <td className={td}>
                      <input type="checkbox" name={`required_${f.key}`} defaultChecked={s.required} aria-label={`${f.label} required`} />
                    </td>
                    <td className={td}>
                      <input type="checkbox" name={`hidden_${f.key}`} defaultChecked={s.hidden} aria-label={`Hide ${f.label}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button className={btn}>Save</button>
      </ActionForm>
    </>
  );
}
