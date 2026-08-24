import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lagata Ultimate Team — FC Tournament Tracker",
  description: "Randomise fixtures, record scores and settle the table for your FC tournament.",
  openGraph: {
    title: "Lagata Ultimate Team — FC Tournament Tracker",
    description: "Your tournament. Your table. Your ultimate team.",
    images: [{ url: "/og-v3.png", width: 1200, height: 630, alt: "Lagata Ultimate Team live tournament tracker" }],
  },
  twitter: { card: "summary_large_image", images: ["/og-v3.png"] },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Lagata UT" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5ef" },
    { media: "(prefers-color-scheme: dark)", color: "#101813" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <head><script src="/register-sw.js" defer /></head>
    <body className={geist.variable}>{children}</body>
  </html>;
}
