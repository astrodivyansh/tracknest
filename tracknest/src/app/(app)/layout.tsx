import { cookies } from "next/headers";
import { and, count, eq, lt, lte, sql } from "drizzle-orm";
import { withOrg } from "@/db";
import { checkouts, maintenance } from "@/db/schema";
import { AppHeader } from "@/components/app-header";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { isAdmin, requireUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayIn } from "@/lib/maintenance";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [counts, jar] = await Promise.all([
    withOrg(user.orgId, async (tx) => ({
      overdue: (await tx.select({ n: count() }).from(checkouts).where(and(eq(checkouts.state, "open"), lt(checkouts.dueAt, new Date()))))[0].n,
      maintenanceDue: (
        await tx
          .select({ n: count() })
          .from(maintenance)
          .where(and(eq(maintenance.state, "scheduled"), lte(maintenance.dueDate, sql`${todayIn(user.timezone)} + 7`)))
      )[0].n,
    })),
    cookies(),
  ]);

  return (
    // The sidebar remembers open/collapsed in a cookie (set by components/ui/sidebar.tsx).
    <SidebarProvider defaultOpen={jar.get("sidebar_state")?.value !== "false"}>
      <AppSidebar isAdmin={isAdmin(user)} canEdit={can(user, "add")} counts={counts} logoVersion={user.logoVersion} orgName={user.orgName} disabled={user.disabled} />
      <SidebarInset className="min-w-0">
        <AppHeader user={{ name: user.name, orgName: user.orgName, role: user.role }} canEdit={can(user, "add")} />
        <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6 print:max-w-none print:p-0">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
