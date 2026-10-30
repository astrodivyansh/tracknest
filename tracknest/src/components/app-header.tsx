"use client";

import Link from "next/link";
import { useTheme } from "next-themes";
import { LogOut, Monitor, Moon, Plus, Search, Sun, UserRound } from "lucide-react";
import { logout } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Top bar: asset search, "Add an asset", theme switch and the user menu. */
export function AppHeader({ user, canEdit }: { user: { name: string; orgName: string; role: string }; canEdit: boolean }) {
  const { setTheme } = useTheme();
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur print:hidden">
      <SidebarTrigger />
      <form action="/assets" className="relative w-full max-w-sm" role="search">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input name="q" placeholder="Search assets by tag, name, serial…" aria-label="Search assets" className="pl-8" />
      </form>
      <div className="ml-auto flex items-center gap-1">
        {canEdit && (
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/assets/new">
              <Plus /> Add an asset
            </Link>
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Theme">
              <Sun className="dark:hidden" />
              <Moon className="hidden dark:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun /> Light
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon /> Dark
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor /> System
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="hidden max-w-40 truncate md:inline">{user.name}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="font-normal">
              <p className="font-medium">{user.name}</p>
              <p className="text-xs text-muted-foreground">
                {user.orgName} · <span className="capitalize">{user.role}</span>
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/account">
                <UserRound /> My account
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={logout}>
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut /> Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
