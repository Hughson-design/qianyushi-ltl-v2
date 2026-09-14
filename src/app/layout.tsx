import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qianyushi LTL",
  description: "Shenzhen Qianyushi Supply Chain Service Co., Ltd. LTL quoting and BOL platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
