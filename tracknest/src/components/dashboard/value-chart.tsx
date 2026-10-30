"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = { value: { label: "Value", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Purchase value of active assets per category. */
export function ValueChart({ data, currency }: { data: { category: string; value: number; count: number }[]; currency: string }) {
  const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  if (data.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No asset costs recorded yet.</p>;
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} margin={{ left: 8, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="category" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={80} tickFormatter={(v: number) => money(v)} />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent formatter={(v, _n, item) => `${money(Number(v))} · ${item.payload.count} asset${item.payload.count === 1 ? "" : "s"}`} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={6} />
      </BarChart>
    </ChartContainer>
  );
}
