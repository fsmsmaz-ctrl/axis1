import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "AXIS - نظام إدارة عمليات Pipe Jacking",
  description: "نظام متكامل لإدارة عمليات الحفر بتقنية Pipe Jacking / Microtunneling لشركة AXIS",
  keywords: ["AXIS", "Pipe Jacking", "Microtunneling", "إدارة المشاريع", "عمان"],
  authors: [{ name: "AXIS" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AXIS",
  },
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body
        className={`${cairo.variable} ${tajawal.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-cairo), var(--font-tajawal), sans-serif" }}
      >
        {children}
        {/* الرسائل الترحيبية/التنبيهات: أعلى الوسط مع تعويض النوتش (safe-area)
            حتى لا تظهر ملتصقة بحافة الشاشة أو تحت شريط الحالة في الهاتف */}
        <SonnerToaster
          position="top-center"
          dir="auto"
          offset="calc(20px + env(safe-area-inset-top, 0px))"
          mobileOffset="calc(14px + env(safe-area-inset-top, 0px))"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js').catch(function() {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}


