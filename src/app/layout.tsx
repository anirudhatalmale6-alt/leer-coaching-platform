import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LEER - 1:1 video coaching",
  description:
    "Trainers sell 1:1 video coaching passes, deliver frame-by-frame analysis, and get paid 80/20 through escrow.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
