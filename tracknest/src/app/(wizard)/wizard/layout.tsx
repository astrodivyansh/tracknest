import Link from "next/link";
import { logout } from "@/app/(auth)/actions";
import { requireUser } from "@/lib/auth";

export default async function WizardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser("admin");
  return (
    <div className="min-h-svh bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 md:px-6">
        <Link href="/dashboard" className="truncate font-semibold text-foreground">
          {user.orgName}
        </Link>
        <div className="flex shrink-0 items-center gap-4 text-sm text-muted-foreground">
          <span className="hidden sm:inline">{user.name}</span>
          <form action={logout}>
            <button className="hover:text-foreground hover:underline">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">{children}</main>
    </div>
  );
}
