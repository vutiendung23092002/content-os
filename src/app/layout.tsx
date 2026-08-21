import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DashboardShell } from "@/app/ui/dashboard-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Han Content OS",
  description: "Công cụ nội bộ quản lý nội dung Facebook Page.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
