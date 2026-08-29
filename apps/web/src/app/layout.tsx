import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const themeInitializationScript = `
(() => {
  const darkThemeQuery = "(prefers-color-scheme: dark)";
  let theme = "light";

  try {
    const storedTheme = window.localStorage.getItem("finance-os-theme");
    theme = storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : window.matchMedia(darkThemeQuery).matches ? "dark" : "light";
  } catch {
    theme = window.matchMedia(darkThemeQuery).matches ? "dark" : "light";
  }

  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chelaro – Jede Zahl. Belegt.",
  description:
    "Offene, KI-gestützte Finanz- und Belegverwaltung mit prüfbaren Quellen und menschlicher Kontrolle.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="de"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        {children}
        <Script id="finance-os-theme" strategy="beforeInteractive">
          {themeInitializationScript}
        </Script>
      </body>
    </html>
  );
}
