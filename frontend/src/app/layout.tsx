import type { Metadata } from "next";
import "./globals.css";
import { DEFAULT_THEME } from "@/lib/theme";
import ThemeInit from "@/components/ThemeInit";

export const metadata: Metadata = {
  title: "Pi Camera",
  description: "Raspberry Pi camera control",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      data-theme={DEFAULT_THEME}
      suppressHydrationWarning
    >
      <body
        className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-background text-foreground select-none"
        suppressHydrationWarning
      >
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
