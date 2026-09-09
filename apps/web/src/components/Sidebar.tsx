"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { navForRole } from "@/lib/nav";
import { CurrentUser } from "@/lib/types";
import { apiFetch } from "@/lib/api";

const ROLE_LABEL: Record<CurrentUser["role"], string> = {
  EMPLOYEE: "employee",
  MANAGER: "manager",
  ADMIN: "admin",
};

export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navForRole(user.role);
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => void 0);
    router.replace("/login");
  }

  return (
    <>
      {/* Mobile/tablet top bar */}
      <div className="fixed inset-x-0 top-0 z-30 flex items-center justify-between bg-chs-charcoal px-4 py-3 text-white lg:hidden">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="Cyberhealth" width={30} height={30} className="rounded" />
          <div className="text-sm font-bold leading-tight">Cyberhealth</div>
        </div>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="rounded-full p-2 hover:bg-white/10"
        >
          <Menu size={22} />
        </button>
      </div>

      {/* Mobile/tablet off-canvas drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-chs-charcoal text-white">
            <SidebarContent
              user={user}
              items={items}
              pathname={pathname}
              signOut={signOut}
              onNavigate={() => setMobileOpen(false)}
              closeButton={
                <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="rounded-full p-2 hover:bg-white/10">
                  <X size={18} />
                </button>
              }
            />
          </aside>
        </div>
      )}

      {/* Desktop fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col bg-chs-charcoal text-white lg:flex">
        <SidebarContent user={user} items={items} pathname={pathname} signOut={signOut} />
      </aside>
    </>
  );
}

function SidebarContent({
  user,
  items,
  pathname,
  signOut,
  onNavigate,
  closeButton,
}: {
  user: CurrentUser;
  items: ReturnType<typeof navForRole>;
  pathname: string | null;
  signOut: () => void;
  onNavigate?: () => void;
  closeButton?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-6 py-6">
        <div className="flex items-center gap-3">
          <Image src="/logo.png" alt="Cyberhealth" width={40} height={40} className="rounded" />
          <div>
            <div className="text-lg font-bold leading-tight">Cyberhealth</div>
            <div className="text-[11px] font-semibold tracking-widest text-chs-gold">
              EMPLOYEE PORTAL
            </div>
          </div>
        </div>
        {closeButton}
      </div>

      <nav className="mt-2 flex-1 space-y-1 overflow-y-auto px-4">
        {items.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-chs-gold text-chs-charcoal"
                  : "text-gray-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-6 py-5">
        <div className="text-sm font-semibold">{user.name}</div>
        <div className="text-xs text-gray-400">
          {user.email} · {ROLE_LABEL[user.role]}
        </div>
        <button
          onClick={signOut}
          className="mt-3 flex items-center gap-2 text-sm text-gray-400 hover:text-white"
        >
          <LogOut size={14} />
          Sign out
        </button>
      </div>
    </>
  );
}
