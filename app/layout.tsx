import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { PUBLIC_SITE_URL } from "@/app/lib/site-url";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The site's own address, for absolute URLs in metadata (canonical, share
// images).
const siteUrl = PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Support Ticket Triage",
  description: "AI-assisted support ticket triage",
  openGraph: { siteName: "Support Triage" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
