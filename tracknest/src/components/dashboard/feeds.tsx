"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type FeedItem = { id: string; assetId: string; tag: string; text: string; when: string };

/** Recent activity in tabs (checked out, checked in, in maintenance / broken). Text is formatted on the server. */
export function Feeds({ tabs }: { tabs: { key: string; label: string; items: FeedItem[]; empty: string }[] }) {
  return (
    <Tabs defaultValue={tabs[0].key}>
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.key} value={t.key}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.key} value={t.key}>
          <ul className="divide-y text-sm">
            {t.items.map((it) => (
              <li key={it.id} className="py-2">
                <Link href={`/assets/${it.assetId}`} className="font-mono text-primary hover:underline">
                  {it.tag}
                </Link>{" "}
                {it.text}
                <span className="block text-xs text-muted-foreground">{it.when}</span>
              </li>
            ))}
            {t.items.length === 0 && <li className="py-6 text-center text-muted-foreground">{t.empty}</li>}
          </ul>
        </TabsContent>
      ))}
    </Tabs>
  );
}
