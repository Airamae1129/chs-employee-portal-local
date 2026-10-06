"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Mail, ShieldCheck, Smartphone } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { AUTH_SUBMIT_CLASS, CodeInput } from "./LoginSplit";

export interface MfaStart {
  stage: "SETUP" | "VERIFY";
  mfaToken: string;
  method: "EMAIL" | "TOTP";
  totpAvailable: boolean;
  maskedEmail: string;
  emailSent: boolean;
}

interface TotpSetup {
  secret: string;
  qrDataUrl: string;
}

type Method = "TOTP" | "EMAIL";

const RESEND_SECONDS = 60;

/**
 * The second sign-in step.
 *
 * "SETUP" (no authenticator app linked yet): the user must scan the QR
 * code and confirm an app code — email codes aren't offered until then.
 * "VERIFY" (app linked): the user picks an app code or an emailed code.
 */
export function MfaChallenge({
  start,
  onVerified,
  onCancel,
}: {
  start: MfaStart;
  onVerified: (user: { mustResetPassword: boolean }) => void;
  onCancel: () => void;
}) {
  const enrolling = start.stage === "SETUP";
  const [method, setMethod] = useState<Method>("TOTP");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState<TotpSetup | null>(null);
  const [emailSentAt, setEmailSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setupStarted = useRef(false);

  useEffect(() => {
    if (!emailSentAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [emailSentAt]);
  const resendIn = emailSentAt ? Math.max(0, RESEND_SECONDS - Math.floor((now - emailSentAt) / 1000)) : 0;

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

  // Setup goes straight to the QR code — there's nothing to choose yet.
  useEffect(() => {
    if (!enrolling || setupStarted.current) return;
    setupStarted.current = true;
    run(async () => {
      setTotp(await apiFetch<TotpSetup>("/auth/mfa/totp/start", { method: "POST", body: JSON.stringify({ mfaToken: start.mfaToken }) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolling, start.mfaToken]);

  const sendEmail = () =>
    run(async () => {
      await apiFetch("/auth/mfa/email", { method: "POST", body: JSON.stringify({ mfaToken: start.mfaToken }) });
      setEmailSentAt(Date.now());
      setNow(Date.now());
    });

  function pick(next: Method) {
    if (next === method) return;
    setMethod(next);
    setCode("");
    setError(null);
    if (next === "EMAIL" && !emailSentAt) sendEmail();
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { user } = await apiFetch<{ user: { mustResetPassword: boolean } }>("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ mfaToken: start.mfaToken, method, code }),
      });
      onVerified(user);
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-chs-gold">
        <ShieldCheck size={20} />
        <span className="text-xs font-semibold uppercase tracking-widest">Two-step verification</span>
      </div>

      <form onSubmit={verify} className="space-y-5">
        {enrolling ? (
          <div>
            <h2 className="text-2xl font-bold text-chs-charcoal">Set up your authenticator app</h2>
            <p className="mt-1 text-sm text-gray-500">
              Every CHS account needs an authenticator app (Microsoft Authenticator, Google Authenticator, Authy or similar) before signing in.
            </p>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-gray-500">
              <li>In your app, add an account and scan this QR code.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            {totp ? (
              <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-gray-200 p-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={totp.qrDataUrl} alt="Authenticator QR code" width={176} height={176} />
                <div className="text-center text-xs text-gray-500">
                  Can't scan? Enter this key:
                  <div className="mt-1 select-all break-all font-mono text-sm text-chs-charcoal">{totp.secret}</div>
                </div>
              </div>
            ) : (
              <div className="mt-4 h-48 animate-pulse rounded-xl bg-gray-100" />
            )}
            <p className="mt-3 text-xs text-gray-400">After this, you can sign in with an app code or a code sent to {start.maskedEmail}.</p>
          </div>
        ) : (
          <div>
            <h2 className="text-2xl font-bold text-chs-charcoal">Verify it's you</h2>
            <p className="mt-1 text-sm text-gray-500">Choose how to get your 6-digit code.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1" role="tablist">
              <MethodTab active={method === "TOTP"} icon={<Smartphone size={16} />} label="Authenticator app" onClick={() => pick("TOTP")} />
              <MethodTab active={method === "EMAIL"} icon={<Mail size={16} />} label="Email code" onClick={() => pick("EMAIL")} />
            </div>
            <p className="mt-3 text-sm text-gray-500">
              {method === "TOTP"
                ? "Open your authenticator app and enter the code for CHS Employee Portal."
                : emailSentAt
                  ? `We sent a code to ${start.maskedEmail}. It expires in 10 minutes.`
                  : "Sending your code..."}
            </p>
          </div>
        )}

        <CodeInput value={code} onChange={setCode} />

        {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}

        <button type="submit" disabled={busy || code.length !== 6} className={AUTH_SUBMIT_CLASS}>
          <ShieldCheck size={16} />
          {busy ? "Checking..." : enrolling ? "Verify & finish setup" : "Verify"}
        </button>

        {!enrolling && method === "EMAIL" ? (
          <div className="text-sm">
            <button type="button" disabled={busy || resendIn > 0} onClick={sendEmail} className="font-medium text-chs-charcoal hover:underline disabled:text-gray-400 disabled:no-underline">
              {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
            </button>
          </div>
        ) : null}
      </form>

      <p className="mt-6 text-center text-sm">
        <button type="button" onClick={onCancel} className="text-gray-500 hover:underline">
          Back to sign in
        </button>
      </p>
    </div>
  );
}

function MethodTab({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? "bg-white text-chs-charcoal shadow-sm" : "text-gray-500 hover:text-chs-charcoal"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
