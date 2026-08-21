import type { Metadata } from "next";
import { Be_Vietnam_Pro } from "next/font/google";
import type { ReactNode } from "react";
import { DashboardShell } from "@/app/ui/dashboard-shell";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  weight: ["400", "500", "600", "700", "800", "900"],
  subsets: ["vietnamese"],
  display: "swap",
  variable: "--font-be-vietnam-pro",
});

export const metadata: Metadata = {
  title: "Han Content OS",
  description: "Công cụ nội bộ quản lý nội dung Facebook Page.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi" className={beVietnamPro.variable}>
      <body>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
