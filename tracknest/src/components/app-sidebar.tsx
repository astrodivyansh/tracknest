"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  ChevronRight,
  FileBarChart,
  FileText,
  LayoutDashboard,
  Package,
  Settings,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type Leaf = { href: string; label: string; count?: number };
type Group = { label: string; icon: LucideIcon; href?: string; items?: Leaf[] };

/** Left navigation, grouped like AssetTiger's. Alert counts come from the server layout. */
export function AppSidebar({
  isAdmin,
  canEdit,
  counts,
  logoVersion,
  orgName,
  disabled,
}: {
  isAdmin: boolean;
  canEdit: boolean;
  counts: { overdue: number; maintenanceDue: number };
  logoVersion: string | null;
  orgName: string;
  disabled: string[]; // features the org turned off (lib/permissions.ts)
}) {
  const path = usePathname();
  const on = (feature: string) => !disabled.includes(feature);
  const active = (href: string) => path === href || path.startsWith(`${href}/`);

  const groups: Group[] = [
    { label: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    {
      label: "Alerts",
      icon: Bell,
      items: [
        { href: "/reports/overdue", label: "Assets past due", count: counts.overdue },
        ...(on("maintenance") ? [{ href: "/maintenance", label: "Maintenance due", count: counts.maintenanceDue }] : []),
        ...(isAdmin ? [{ href: "/setup/alerts", label: "Alert settings and emails" }] : []),
      ],
    },
    {
      label: "Assets",
      icon: Boxes,
      items: [
        { href: "/assets", label: "List of assets" },
        ...(canEdit ? [{ href: "/assets/new", label: "Add an asset" }] : []),
        { href: "/scan", label: "Scan a label" },
        ...(on("reserve") ? [{ href: "/reservations", label: "Reservations" }] : []),
        ...(on("maintenance") ? [{ href: "/maintenance", label: "Maintenance" }] : []),
        { href: "/audits", label: "Audits" },
        { href: "/gallery", label: "Gallery" },
      ],
    },
    ...(on("inventory") ? [{ label: "Inventory", icon: Package, href: "/inventory" }] : []),
    ...(on("records") ? [{
      label: "Contracts & cover",
      icon: FileText,
      items: [
        { href: "/records/contract", label: "Contracts and licences" },
        { href: "/records/insurance", label: "Insurance" },
        { href: "/records/funding", label: "Funding" },
      ],
    }] : []),
    {
      label: "Reports",
      icon: FileBarChart,
      items: [
        { href: "/reports", label: "All reports" },
        { href: "/history", label: "Check-in/out history" },
      ],
    },
    {
      label: "People",
      icon: Users,
      items: [{ href: "/people", label: "People" }, ...(on("lease") ? [{ href: "/customers", label: "Customers (leasing)" }] : []), ...(isAdmin ? [{ href: "/team", label: "Team and invites" }] : [])],
    },
    {
      label: "Tools",
      icon: Wrench,
      items: [...(canEdit ? [{ href: "/import", label: "Import and export" }] : []), { href: "/labels", label: "Print labels" }],
    },
    { label: "Setup", icon: Settings, href: "/setup" },
  ];
  const alerts = counts.overdue + counts.maintenanceDue;

  return (
    <Sidebar collapsible="icon" className="print:hidden">
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
          {logoVersion ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked file
            <img src={`/logo?v=${logoVersion}`} alt={orgName} className="h-8 max-w-40 rounded bg-white object-contain p-0.5" />
          ) : (
            <span className="text-lg font-bold text-primary">TrackNest</span>
          )}
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {groups.map((g) =>
              g.href ? (
                <SidebarMenuItem key={g.label}>
                  <SidebarMenuButton asChild isActive={active(g.href)} tooltip={g.label}>
                    <Link href={g.href}>
                      <g.icon />
                      <span>{g.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                <Collapsible key={g.label} asChild defaultOpen={g.items!.some((i) => active(i.href)) || g.label === "Assets"} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip={g.label}>
                        <g.icon />
                        <span>{g.label}</span>
                        <ChevronRight className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    {g.label === "Alerts" && alerts > 0 && (
                      <SidebarMenuBadge className="mr-6 bg-destructive text-white" aria-label={`${alerts} alerts`}>
                        {alerts}
                      </SidebarMenuBadge>
                    )}
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {g.items!.map((i) => (
                          <SidebarMenuSubItem key={i.href + i.label}>
                            <SidebarMenuSubButton asChild isActive={path === i.href}>
                              <Link href={i.href}>
                                <span>{i.label}</span>
                                {!!i.count && <span className="ml-auto rounded bg-destructive/10 px-1.5 text-xs font-medium text-destructive">{i.count}</span>}
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ),
            )}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
