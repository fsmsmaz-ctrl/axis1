import type { Metadata } from "next";
import { Cairo, Tajawal } from "next/font/google";
import "./globals.css";
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
    icon: "/logo.png",
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
        <SonnerToaster position="top-center" />
      </body>
    </html>
  );
}
