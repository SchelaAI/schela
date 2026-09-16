import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Schela — AI Recruiting Coordinator",
  description: "AI interview coordination across WhatsApp and email.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
