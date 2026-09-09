"use client";

import { FormEvent, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "@/lib/api";
import { notifySuccess, notifyError } from "@/lib/alerts";
import { KeyRound } from "lucide-react";

/**
 * Forced first-login password reset (Staff Accounts: "user input email
 * and temporary password, then next page they need to Create a New
 * Password and Confirm Password"). Reached from /login when the
 * account still has mustResetPassword=true; requires the session
 * cookie the temp-password login already issued.
 */
export default function SetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/auth/set-password", { method: "POST", body: JSON.stringify({ newPassword }) });
      await notifySuccess("Password set", "Your new password is active. Taking you to your dashboard...");
      router.push("/dashboard");
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
      setError(message);
      notifyError("Couldn't set password", message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-chs-bg px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-card">
        <div className="mb-2 flex items-center gap-3">
          <Image src="/logo.png" alt="Cyberhealth" width={36} height={36} className="rounded" />
          <div className="text-lg font-bold text-chs-charcoal">Cyberhealth</div>
        </div>
        <h2 className="mt-4 text-2xl font-bold text-chs-charcoal">Set a new password</h2>
        <p className="mt-1 text-sm text-gray-500">
          This is your first sign-in. Choose a permanent password to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">New password</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-chs-charcoal outline-none focus:border-chs-gold focus:ring-1 focus:ring-chs-gold"
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Confirm new password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-chs-charcoal outline-none focus:border-chs-gold focus:ring-1 focus:ring-chs-gold"
              placeholder="Re-enter password"
            />
          </div>

          {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-chs-gold py-3 text-sm font-semibold text-chs-charcoal shadow-sm transition-all hover:opacity-90 hover:shadow-md disabled:opacity-60"
          >
            <KeyRound size={16} />
            {submitting ? "Saving..." : "Save & continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
