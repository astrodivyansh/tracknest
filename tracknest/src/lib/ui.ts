// Shared Tailwind class strings.
export const input =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100";
export const label = "block space-y-1 text-sm font-medium text-gray-700";
export const btn =
  "inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";
export const card = "rounded-lg border border-gray-200 bg-white p-5";
export const th = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500";
export const td = "px-3 py-2 text-sm text-gray-800";
export const h1 = "text-2xl font-semibold text-gray-900";
export const h2 = "text-base font-semibold text-gray-900";

export const STATUS_BADGE: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  checked_out: "bg-blue-100 text-blue-800",
  under_maintenance: "bg-amber-100 text-amber-800",
  lost: "bg-red-100 text-red-800",
  broken: "bg-red-100 text-red-800",
  disposed: "bg-gray-200 text-gray-700",
};
