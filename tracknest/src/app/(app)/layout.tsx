import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logout } from "../(auth)/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/assets", label: "Assets" },
  { href: "/scan", label: "Scan" },
  { href: "/history", label: "Check-in/out history" },
  { href: "/people", label: "People" },
  { href: "/setup", label: "Setup" },
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/dashboard" className="font-bold text-indigo-700">
            TrackNest
          </Link>
          <nav className="flex flex-wrap gap-4 text-sm text-gray-600">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-gray-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-gray-600">
            <span>
              {user.name} · {user.orgName} · <span className="capitalize">{user.role}</span>
            </span>
            <form action={logout}>
              <button className="text-indigo-600 hover:underline">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
    </div>
  );
}
