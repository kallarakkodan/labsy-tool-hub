import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/*
 * Self-hosted, latin-subset variable fonts (PRD §5.2). The production server has
 * no internet egress, so a hosted font URL would silently fall back.
 * See src/app/fonts/README.md for provenance.
 */
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
  preload: true,
});

const jetbrainsMono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
  preload: true,
});

export const metadata: Metadata = {
  title: "Internal Tool Hub",
  description: "Labsy internal file distribution — OS images, installers, and deployers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`dark ${inter.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
