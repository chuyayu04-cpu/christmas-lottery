import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "聖誕禮物抽籤",
  description: "每人限抽一次。抽中後點開禮物才看得到主題，結果只顯示給你自己看。",
  icons: { icon: "/favicon.svg" },
  appleWebApp: {
    capable: true,
    title: "聖誕禮物抽籤",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0c1f18",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="snow" />
        {children}
      </body>
    </html>
  );
}
