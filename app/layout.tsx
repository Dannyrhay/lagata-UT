import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Full Time — FC Tournament Tracker",
  description: "Randomise fixtures, record scores and settle the table for your FC tournament.",
  openGraph: {
    title: "Full Time — FC Tournament Tracker",
    description: "Your FC tournament. Sorted.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Full Time FC tournament tracker" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={geist.variable}>{children}</body></html>;
}
