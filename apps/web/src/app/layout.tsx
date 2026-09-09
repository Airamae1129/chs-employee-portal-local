import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CHS Employee Portal",
  description: "Cyberhealth staff self-service: timekeeping, HR requests, policies, payslips.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans text-[#1A1512]">{children}</body>
    </html>
  );
}
