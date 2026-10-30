import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { CompanyFields, LogoSection } from "@/components/company-fields";
import { requireUser } from "@/lib/auth";
import { btn, card, h1 } from "@/lib/ui";
import { saveCompany } from "./actions";

export default async function CompanyPage() {
  const user = await requireUser("admin");
  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.orgId));

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
          <CompanyFields org={org} />
          <p className="text-xs text-muted-foreground sm:col-span-2">
            The prefix applies to new tags only (e.g. {org.tagPrefix}-{String(org.nextTagSeq).padStart(6, "0")}). The financial year is used by the dashboard and the depreciation schedule.
          </p>
          <div className="sm:text-right">
            <button className={btn}>Save</button>
          </div>
        </ActionForm>
      </section>

      <LogoSection logoKey={org.logoKey} />
    </>
  );
}
