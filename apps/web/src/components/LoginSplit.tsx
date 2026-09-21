"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { LogIn } from "lucide-react";

/**
 * Single split-screen login shape for every role (Section 2 / 4.2,
 * revised): one page, no portal picker — the backend resolves the
 * account's real role and the dashboard shell adapts its nav
 * accordingly (see lib/nav.ts).
 */
export function LoginSplit({
  onSubmit,
  submitting,
  error,
}: {
  onSubmit: (email: string, password: string) => void;
  submitting: boolean;
  error: string | null;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit(email, password);
  }

  return (
    <div className="flex min-h-screen w-full flex-col lg:flex-row">
      <div className="relative flex w-full flex-col justify-between overflow-hidden bg-chs-charcoal px-6 py-8 text-white sm:px-10 sm:py-10 lg:w-1/2 lg:px-14 lg:py-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative z-10 flex items-center gap-3">
          <div className="rounded-lg bg-white p-1"><Image src="/logo-signin.png" alt="Cyberhealth" width={44} height={44} /></div>
          <div>
            <div className="text-xl font-bold">Cyberhealth</div>
            <div className="text-xs font-semibold tracking-widest text-chs-gold">
              EMPLOYEE PORTAL
            </div>
          </div>
        </div>

        <div className="relative z-10 my-10 max-w-md lg:my-0">
          <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
            Your work day,
            <br />
            <span className="text-chs-gold">in one place.</span>
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-gray-300">
            Sign in with your CHS staff account — Employee, Manager, or Admin. You&apos;ll land in the
            right portal automatically.
          </p>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-xs text-gray-400">
          <span>🛡️</span> CHS staff only · sessions expire after 12 hours
        </div>
      </div>

      <div className="flex w-full flex-1 items-center justify-center bg-white px-6 py-10 sm:px-8 lg:w-1/2 lg:py-12">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-bold text-chs-charcoal">Sign in</h2>
          <p className="mt-1 text-sm text-gray-500">Use your CHS staff account.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-chs-charcoal outline-none focus:border-chs-gold focus:ring-1 focus:ring-chs-gold"
                placeholder="you@cyberhealth.ie"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-chs-charcoal outline-none focus:border-chs-gold focus:ring-1 focus:ring-chs-gold"
                placeholder="••••••••"
              />
            </div>

            {error ? (
              <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-chs-gold py-3 text-sm font-semibold text-chs-charcoal shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:opacity-60"
            >
              <LogIn size={16} />
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="mt-4 text-xs text-gray-400">
            Forgotten password? An administrator can reset it under Staff Accounts.
          </p>
        </div>
      </div>
    </div>
  );
}
