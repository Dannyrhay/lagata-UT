import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Lagata Ultimate Team — FC Tournament Tracker",
  description: "Randomise fixtures, record scores and settle the table for your FC tournament.",
  openGraph: {
    title: "Lagata Ultimate Team — FC Tournament Tracker",
    description: "Your tournament. Your table. Your ultimate team.",
    images: [{ url: "/og-v2.png", width: 1200, height: 630, alt: "Lagata Ultimate Team tournament tracker" }],
  },
  twitter: { card: "summary_large_image", images: ["/og-v2.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={geist.variable}>{children}</body></html>;
}
