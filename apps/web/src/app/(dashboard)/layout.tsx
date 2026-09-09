"use client";

import { Sidebar } from "@/components/Sidebar";
import { useCurrentUser } from "@/lib/useCurrentUser";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, error } = useCurrentUser();

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-chs-bg text-gray-400">Loading...</div>;
  }

  if (error) {
    return <div className="flex min-h-screen items-center justify-center bg-chs-bg text-red-500">{error}</div>;
  }

  if (!user) return null; // redirect to login is in-flight

  return (
    <div className="min-h-screen bg-chs-bg">
      <Sidebar user={user} />
      <main className="min-h-screen px-4 py-6 pt-20 sm:px-6 lg:ml-72 lg:px-10 lg:py-8 lg:pt-8">{children}</main>
    </div>
  );
}
