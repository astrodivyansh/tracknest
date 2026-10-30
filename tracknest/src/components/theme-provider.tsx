"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/** Light / dark / system theme, stored per browser; adds the `dark` class on <html>. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </NextThemes>
  );
}
