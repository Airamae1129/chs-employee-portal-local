"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { KeyRound, Mail, ShieldCheck, Smartphone } from "lucide-react";
import { PageHeader, Card, Badge } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { AUTH_INPUT_CLASS, CodeInput } from "@/components/LoginSplit";
import { apiFetch, ApiError } from "@/lib/api";
import { notifyError, notifySuccess } from "@/lib/alerts";
import { STRONG_PASSWORD_HINT, STRONG_PASSWORD_MESSAGE, STRONG_PASSWORD_REGEX } from "@/lib/passwordPolicy";

interface Security {
  mfaMethod: "EMAIL" | "TOTP";
  mfaEnrolledAt: string | null;
  totpEnabled: boolean;
  maskedEmail: string;
}

const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Please try again.");

/** Account Security: the linked authenticator app, and changing the password (confirmed by an emailed code). */
export default function AccountSecurityPage() {
  const [security, setSecurity] = useState<Security | null>(null);
  const load = useCallback(() => apiFetch<Security>("/auth/security").then(setSecurity), []);
  useEffect(() => {
    load();
  }, [load]);

  if (!security) return null;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Account Security" />
      <div className="space-y-6">
        <TwoStepCard security={security} onChanged={load} />
        <ChangePasswordCard maskedEmail={security.maskedEmail} />
      </div>
    </div>
  );
}

function TwoStepCard({ security, onChanged }: { security: Security; onChanged: () => void }) {
  const [setup, setSetup] = useState<{ secret: string; qrDataUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function startApp() {
    setBusy(true);
    try {
      setSetup(await apiFetch("/auth/security/totp/start", { method: "POST" }));
      setCode("");
    } catch (e) {
      notifyError("Couldn't start setup", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmApp(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/auth/security/totp/confirm", { method: "POST", body: JSON.stringify({ code }) });
      setSetup(null);
      await notifySuccess("Authenticator app linked", "Use codes from this app the next time you sign in.");
      onChanged();
    } catch (e) {
      notifyError("Couldn't link app", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 text-chs-gold" size={22} />
          <div>
            <h2 className="text-lg font-semibold text-chs-charcoal">Two-step verification</h2>
            <p className="mt-0.5 text-sm text-gray-500">Required for every sign-in.</p>
          </div>
        </div>
        <Badge tone="green">On</Badge>
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
          <Smartphone size={18} className="text-chs-charcoal" />
          <div className="text-sm">
            <div className="font-medium text-chs-charcoal">Authenticator app</div>
            <div className="text-gray-500">{security.totpEnabled ? "Linked. Use the code from your app at sign-in." : "Not linked yet."}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
          <Mail size={18} className="text-chs-charcoal" />
          <div className="text-sm">
            <div className="font-medium text-chs-charcoal">Email code</div>
            <div className="text-gray-500">Also available at sign-in. Codes go to {security.maskedEmail}.</div>
          </div>
        </div>
      </div>

      {setup ? (
        <form onSubmit={confirmApp} className="mt-5 space-y-4">
          <p className="text-sm text-gray-600">Scan this QR code with your authenticator app, then enter the 6-digit code it shows. This replaces your previously linked phone.</p>
          <div className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 p-4 sm:flex-row sm:gap-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qrDataUrl} alt="Authenticator QR code" width={160} height={160} />
            <div className="text-xs text-gray-500">
              Can't scan? Enter this key:
              <div className="mt-1 select-all break-all font-mono text-sm text-chs-charcoal">{setup.secret}</div>
            </div>
          </div>
          <div className="max-w-xs">
            <CodeInput value={code} onChange={setCode} />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>Confirm</Button>
            <Button type="button" variant="secondary" onClick={() => setSetup(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="mt-5">
          <Button variant="secondary" icon={<Smartphone size={16} />} onClick={startApp} disabled={busy}>
            {security.totpEnabled ? "Link a new phone" : "Set up authenticator app"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function ChangePasswordCard({ maskedEmail }: { maskedEmail: string }) {
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/password/change/send-code", { method: "POST" });
      setCodeSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!STRONG_PASSWORD_REGEX.test(newPassword)) return setError(STRONG_PASSWORD_MESSAGE);
    if (newPassword !== confirmPassword) return setError("Passwords do not match.");
    setBusy(true);
    try {
      await apiFetch("/auth/password/change", { method: "POST", body: JSON.stringify({ code, newPassword }) });
      setCodeSent(false);
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      notifySuccess("Password changed", "Use your new password next time you sign in.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 text-chs-gold" size={22} />
        <div>
          <h2 className="text-lg font-semibold text-chs-charcoal">Change password</h2>
          <p className="mt-0.5 text-sm text-gray-500">We'll email a 6-digit code to {maskedEmail} to confirm it's you.</p>
        </div>
      </div>

      {!codeSent ? (
        <div className="mt-5">
          {error ? <div className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}
          <Button icon={<Mail size={16} />} onClick={sendCode} disabled={busy}>
            {busy ? "Sending..." : "Email me a code"}
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-5 max-w-sm space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Code from your email</label>
            <CodeInput value={code} onChange={setCode} />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">New password</label>
            <input type="password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={AUTH_INPUT_CLASS} />
            <p className="mt-1.5 text-xs text-gray-400">{STRONG_PASSWORD_HINT}</p>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-chs-charcoal">Confirm new password</label>
            <input type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={AUTH_INPUT_CLASS} />
          </div>
          {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || code.length !== 6}>{busy ? "Saving..." : "Change password"}</Button>
            <Button type="button" variant="secondary" onClick={sendCode} disabled={busy}>Resend code</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
