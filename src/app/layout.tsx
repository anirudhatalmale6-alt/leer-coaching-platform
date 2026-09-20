import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

/**
 * Typography, per the brand pack: Inter or Plus Jakarta Sans.
 *
 * Both, with a job each - Jakarta for the wordmark and headings, Inter for
 * everything you actually read. next/font downloads them at BUILD time and
 * serves them from our own origin, so there is no request to Google when the
 * page loads and no flash of fallback text. That matters more here than
 * anywhere: this page's traffic is a phone on mobile data, one tap from an
 * Instagram bio, and the spec asks for sub-second loads.
 *
 * Latin subset only, and only the weights actually used.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LEER Sports - 1:1 video coaching",
  description:
    "Trainers sell 1:1 video coaching passes, deliver frame-by-frame analysis, and get paid 80/20 through escrow.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${inter.variable} ${jakarta.variable}`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
