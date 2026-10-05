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

/** Account Security: how the user gets sign-in codes, and changing their password (confirmed by an emailed code). */
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
  const [password, setPassword] = useState("");
  const [switchingToEmail, setSwitchingToEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const usingApp = security.mfaMethod === "TOTP" && security.totpEnabled;

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
      await notifySuccess("Authenticator app linked", "You'll use codes from your app the next time you sign in.");
      onChanged();
    } catch (e) {
      notifyError("Couldn't link app", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function useEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch("/auth/security/use-email", { method: "POST", body: JSON.stringify({ password }) });
      setSwitchingToEmail(false);
      setPassword("");
      await notifySuccess("Switched to email codes", `Sign-in codes will be sent to ${security.maskedEmail}.`);
      onChanged();
    } catch (e) {
      notifyError("Couldn't switch", errorMessage(e));
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
            <p className="mt-0.5 text-sm text-gray-500">Required for every sign-in. Emailed codes always work as a backup.</p>
          </div>
        </div>
        <Badge tone="green">On</Badge>
      </div>

      <div className="mt-5 flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
        {usingApp ? <Smartphone size={18} className="text-chs-charcoal" /> : <Mail size={18} className="text-chs-charcoal" />}
        <div className="text-sm">
          <div className="font-medium text-chs-charcoal">{usingApp ? "Authenticator app" : "Email code"}</div>
          <div className="text-gray-500">{usingApp ? "Codes from your authenticator app." : `Codes sent to ${security.maskedEmail}.`}</div>
        </div>
      </div>

      {setup ? (
        <form onSubmit={confirmApp} className="mt-5 space-y-4">
          <p className="text-sm text-gray-600">Scan this QR code with your authenticator app, then enter the 6-digit code it shows.</p>
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
      ) : switchingToEmail ? (
        <form onSubmit={useEmail} className="mt-5 space-y-3">
          <p className="text-sm text-gray-600">Enter your password to unlink your authenticator app and use email codes instead.</p>
          <input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className={`${AUTH_INPUT_CLASS} max-w-xs`} placeholder="Current password" />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>Switch to email</Button>
            <Button type="button" variant="secondary" onClick={() => setSwitchingToEmail(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant={usingApp ? "secondary" : "primary"} icon={<Smartphone size={16} />} onClick={startApp} disabled={busy}>
            {usingApp ? "Link a new phone" : "Use an authenticator app"}
          </Button>
          {usingApp ? (
            <Button variant="secondary" icon={<Mail size={16} />} onClick={() => setSwitchingToEmail(true)}>
              Use email codes instead
            </Button>
          ) : null}
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
