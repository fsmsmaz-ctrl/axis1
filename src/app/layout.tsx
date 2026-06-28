import type { Metadata } from "next";
import { Cairo, Tajawal } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
});

const tajawal = Tajawal({
  variable: "--font-tajawal",
  subsets: ["arabic", "latin"],
  weight: ["300", "400", "500", "700", "800"],
});

export const metadata: Metadata = {
  title: "AXIS - نظام إدارة عمليات Pipe Jacking",
  description: "نظام متكامل لإدارة عمليات الحفر بتقنية Pipe Jacking / Microtunneling لشركة AXIS",
  keywords: ["AXIS", "Pipe Jacking", "Microtunneling", "إدارة المشاريع", "عمان"],
  authors: [{ name: "AXIS" }],
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body
        className={`${cairo.variable} ${tajawal.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-cairo), var(--font-tajawal), sans-serif" }}
      >
        {children}
        <Toaster />
        <SonnerToaster position="top-center" />
      </body>
    </html>
  );
}
