import type { Metadata } from "next";
import "./globals.css";
import "./shipment-reader.css";

export const metadata: Metadata = {
  title: "Qianyushi LTL",
  appleWebApp: { capable: true, title: "LTL Quotes", statusBarStyle: "default" },
  icons: { apple: { url: "/qianvushi-logo.jpg", type: "image/jpeg" } },
  description: "Shenzhen Qianyushi Supply Chain Service Co., Ltd. LTL quoting and BOL platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
