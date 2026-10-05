"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound, Mail } from "lucide-react";
import { AuthShell, AUTH_INPUT_CLASS, AUTH_SUBMIT_CLASS, CodeInput } from "@/components/LoginSplit";
import { apiFetch, ApiError } from "@/lib/api";
import { STRONG_PASSWORD_HINT, STRONG_PASSWORD_MESSAGE, STRONG_PASSWORD_REGEX } from "@/lib/passwordPolicy";

type Step = "email" | "code" | "password" | "done";

/**
 * Self-service password reset: email → 6-digit code sent to that inbox →
 * new password. The code has to check out before the new-password form
 * appears; the API then hands back a short-lived, single-use reset token.
 */
export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const requestCode = () =>
    run(async () => {
      await apiFetch("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
      setCode("");
      setInfo(null);
      setStep("code");
    });

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    requestCode();
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { resetToken } = await apiFetch<{ resetToken: string }>("/auth/password/verify-code", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      });
      setResetToken(resetToken);
      setStep("password");
    });
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!STRONG_PASSWORD_REGEX.test(newPassword)) return setError(STRONG_PASSWORD_MESSAGE);
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");
    run(async () => {
      await apiFetch("/auth/password/reset", { method: "POST", body: JSON.stringify({ resetToken, newPassword }) });
      setStep("done");
    });
  }

  return (
    <AuthShell>
      {step === "email" && (
        <form onSubmit={submitEmail} className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-chs-charcoal">Reset your password</h2>
            <p className="mt-1 text-sm text-gray-500">Enter your CHS email and we'll send you a 6-digit code.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Email</label>
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={AUTH_INPUT_CLASS} placeholder="you@cyberhealth.ie" />
          </div>
          {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}
          <button type="submit" disabled={busy} className={AUTH_SUBMIT_CLASS}>
            <Mail size={16} />
            {busy ? "Sending..." : "Send code"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={submitCode} className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold text-chs-charcoal">Check your email</h2>
            <p className="mt-1 text-sm text-gray-500">
              If <span className="font-medium text-chs-charcoal">{email}</span> has a CHS account, a 6-digit code is on its way. It expires in 10 minutes.
            </p>
          </div>
          <CodeInput value={code} onChange={setCode} />
          {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}
          {info ? <div className="rounded-lg bg-green-50 px-4 py-2.5 text-sm text-green-700">{info}</div> : null}
          <button type="submit" disabled={busy || code.length !== 6} className={AUTH_SUBMIT_CLASS}>
            {busy ? "Checking..." : "Continue"}
          </button>
          <div className="flex justify-between text-sm">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await apiFetch("/auth/password/forgot", { method: "POST", body: JSON.stringify({ email }) });
                  setInfo("If a new code was due, it's been sent. Codes can be requested once a minute.");
                })
              }
              className="font-medium text-chs-charcoal hover:underline"
            >
              Resend code
            </button>
            <button type="button" onClick={() => { setStep("email"); setError(null); }} className="text-gray-500 hover:underline">
              Use a different email
            </button>
          </div>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={submitPassword} className="space-y-4">
          <div>
            <h2 className="text-2xl font-bold text-chs-charcoal">Choose a new password</h2>
            <p className="mt-1 text-sm text-gray-500">Code confirmed. Set a new password for {email}.</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">New password</label>
            <input type="password" required autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={AUTH_INPUT_CLASS} placeholder="e.g. Cyber#Health26" />
            <p className="mt-1.5 text-xs text-gray-400">{STRONG_PASSWORD_HINT}</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Confirm new password</label>
            <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={AUTH_INPUT_CLASS} placeholder="Re-enter password" />
          </div>
          {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}
          <button type="submit" disabled={busy} className={AUTH_SUBMIT_CLASS}>
            <KeyRound size={16} />
            {busy ? "Saving..." : "Reset password"}
          </button>
        </form>
      )}

      {step === "done" && (
        <div className="text-center">
          <CheckCircle2 size={48} className="mx-auto text-green-600" />
          <h2 className="mt-4 text-2xl font-bold text-chs-charcoal">Password reset</h2>
          <p className="mt-1 text-sm text-gray-500">You can now sign in with your new password.</p>
          <Link href="/login" className={`${AUTH_SUBMIT_CLASS} mt-6`}>
            Go to sign in
          </Link>
        </div>
      )}

      {step !== "done" && (
        <p className="mt-6 text-center text-sm">
          <Link href="/login" className="text-gray-500 hover:underline">
            Back to sign in
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
