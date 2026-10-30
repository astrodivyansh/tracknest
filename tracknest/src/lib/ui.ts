// Shared Tailwind class strings.
export const input =
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring disabled:bg-muted";
export const label = "block space-y-1 text-sm font-medium text-foreground";
export const btn =
  "inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center rounded-md border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50";
export const card = "rounded-lg border border-border bg-card p-5";
export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const td = "px-3 py-2 text-sm text-foreground";
export const h1 = "text-2xl font-semibold text-foreground";
export const h2 = "text-base font-semibold text-foreground";

export const STATUS_BADGE: Record<string, string> = {
  available: "bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-300",
  checked_out: "bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300",
  under_maintenance: "bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300",
  lost: "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300",
  broken: "bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300",
  disposed: "bg-muted text-foreground",
};
