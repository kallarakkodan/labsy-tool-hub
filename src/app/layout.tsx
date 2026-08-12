import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Internal Tool Hub",
  description: "Labsy internal file distribution — OS images, installers, and deployers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
