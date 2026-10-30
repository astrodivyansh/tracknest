/** Dashboard blocks each user can show, hide and reorder (dashboard/customize). */
export const WIDGETS = {
  kpis: "Key numbers",
  value: "Asset value by category",
  calendar: "Alerts calendar",
  activity: "Activity feed",
  overdue: "Overdue returns",
  coming: "Coming up",
} as const;
export type WidgetKey = keyof typeof WIDGETS;
export const WIDGET_KEYS = Object.keys(WIDGETS) as WidgetKey[];

/** A saved layout, ignoring anything no longer valid; no layout means everything. */
export const widgetsFor = (saved: string[] | null) => (saved ? (saved.filter((k) => k in WIDGETS) as WidgetKey[]) : WIDGET_KEYS);
