"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { DARK_ONLY } from "@/src/lib/theme";

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Light mode is off for now: see src/lib/theme.ts.
      forcedTheme={DARK_ONLY ? "dark" : undefined}
    >
      {children}
    </NextThemesProvider>
  );
}
