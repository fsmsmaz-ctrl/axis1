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
        {/* v104: عامل يقظة الإقلاع — مكتوب بـ ES5 خالص حتى يعمل على أقدم المتصفحات.
            المشكلة: شاشة الانتظار الأولى تُرسم من HTML الخادم، فإذا فشل JS في التهيئة
            على جهاز قديم (متصفح قديم/ذاكرة عالقة/طلب معلّق) تبقى الشاشة ظاهرة للأبد
            بلا أي رسالة. هذا العامل يكشف التعطل ويعرض طبقة استرداد بخيارَي:
            إعادة المحاولة، أو الإصلاح ومسح الذاكرة المؤقتة — بلا أي اعتماد على React.
            لا يظهر أبداً على الأجهزة السليمة (يعتمد على علم __AXIS_BOOTED__ من الواجهة). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                window.__AXIS_BOOTED__ = false;
                window.__axisBootError = '';
                try {
                  window.onerror = function (msg) {
                    if (!window.__axisBootError) { window.__axisBootError = String(msg || ''); }
                    return false;
                  };
                  window.addEventListener('unhandledrejection', function (ev) {
                    try {
                      var r = ev && ev.reason;
                      if (!window.__axisBootError && r) {
                        window.__axisBootError = String(r.message || r || '');
                      }
                    } catch (e) {}
                  });
                } catch (e) {}
                window.axisRepairAndReload = function () {
                  try { if (window.localStorage) { window.localStorage.removeItem('axis-storage'); } } catch (e) {}
                  try { if (window.sessionStorage) { window.sessionStorage.clear(); } } catch (e) {}
                  try {
                    if (window.caches && window.caches.keys) {
                      window.caches.keys().then(function (keys) {
                        keys.forEach(function (k) { try { window.caches.delete(k); } catch (e) {} });
                      }).catch(function () {});
                    }
                  } catch (e) {}
                  try {
                    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
                      navigator.serviceWorker.getRegistrations().then(function (regs) {
                        regs.forEach(function (r) { try { r.unregister(); } catch (e) {} });
                      }).catch(function () {});
                    }
                  } catch (e) {}
                  setTimeout(function () { window.location.reload(); }, 900);
                };
                function axisBuildRecovery() {
                  var wrap = document.createElement('div');
                  wrap.setAttribute('dir', 'rtl');
                  wrap.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:#f8fafc;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;';
                  var box = document.createElement('div');
                  box.style.cssText = 'text-align:center;padding:24px;max-width:440px;';
                  var icon = document.createElement('div');
                  icon.textContent = '⚠';
                  icon.style.cssText = 'font-size:38px;margin-bottom:8px;';
                  var title = document.createElement('h1');
                  title.textContent = 'تعذّر تشغيل النظام';
                  title.style.cssText = 'font-size:18px;margin:0 0 8px;color:#111827;';
                  var text = document.createElement('p');
                  text.textContent = 'توقف التحميل قبل اكتماله — غالباً بسبب ذاكرة مؤقتة عالقة أو متصفح قديم على هذا الجهاز. جرّب «إعادة المحاولة» أولاً، وإن تكررت المشكلة استخدم «الإصلاح ومسح الذاكرة».';
                  text.style.cssText = 'color:#4b5563;font-size:13px;line-height:1.7;margin:0 0 14px;';
                  var errBox = document.createElement('div');
                  if (window.__axisBootError) {
                    errBox.textContent = String(window.__axisBootError).slice(0, 300);
                    errBox.style.cssText = 'background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:8px;padding:8px;font-size:11px;margin-bottom:12px;word-break:break-word;direction:ltr;text-align:left;';
                  }
                  var btnRetry = document.createElement('button');
                  btnRetry.textContent = 'إعادة المحاولة';
                  btnRetry.style.cssText = 'padding:10px 18px;background:#2563eb;color:#ffffff;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin:4px;';
                  btnRetry.onclick = function () { window.location.reload(); };
                  var btnFix = document.createElement('button');
                  btnFix.textContent = 'الإصلاح ومسح الذاكرة';
                  btnFix.style.cssText = 'padding:10px 18px;background:#ffffff;color:#2563eb;border:1px solid #2563eb;border-radius:8px;font-size:14px;cursor:pointer;margin:4px;';
                  btnFix.onclick = function () { window.axisRepairAndReload(); };
                  var btnWait = document.createElement('button');
                  btnWait.textContent = 'متابعة الانتظار (شبكة بطيئة)';
                  btnWait.style.cssText = 'display:block;margin:10px auto 0;padding:6px 12px;background:transparent;color:#6b7280;border:none;border-radius:8px;font-size:12px;cursor:pointer;';
                  btnWait.onclick = function () {
                    wrap.parentNode.removeChild(wrap);
                    setTimeout(axisCheckBoot, 30000);
                  };
                  box.appendChild(icon); box.appendChild(title); box.appendChild(text);
                  if (window.__axisBootError) { box.appendChild(errBox); }
                  box.appendChild(btnRetry); box.appendChild(btnFix); box.appendChild(btnWait);
                  wrap.appendChild(box);
                  document.body.appendChild(wrap);
                }
                function axisCheckBoot() {
                  if (window.__AXIS_BOOTED__) return;
                  axisBuildRecovery();
                }
                setTimeout(axisCheckBoot, 25000);
              })();
            `,
          }}
        />
      </body>
    </html>
  );
}
