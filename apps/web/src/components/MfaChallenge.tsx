"use client";

import { FormEvent, useEffect, useState } from "react";
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

type View = "choose" | "EMAIL" | "TOTP";

const RESEND_SECONDS = 60;

/**
 * The second sign-in step. "SETUP" (no MFA yet — every account the first
 * time) makes the user pick email or an authenticator app and prove it
 * works; "VERIFY" asks for a code from the method they set up, with
 * emailed codes always available as a fallback.
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
  const [view, setView] = useState<View>(enrolling ? "choose" : start.method);
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState<TotpSetup | null>(null);
  const [emailSentAt, setEmailSentAt] = useState<number | null>(start.emailSent ? Date.now() : null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const sendEmail = () =>
    run(async () => {
      await apiFetch("/auth/mfa/email", { method: "POST", body: JSON.stringify({ mfaToken: start.mfaToken }) });
      setEmailSentAt(Date.now());
      setNow(Date.now());
    });

  function chooseEmail() {
    setView("EMAIL");
    setCode("");
    if (!emailSentAt) sendEmail();
  }

  function chooseApp() {
    setView("TOTP");
    setCode("");
    if (enrolling && !totp) {
      run(async () => {
        setTotp(await apiFetch<TotpSetup>("/auth/mfa/totp/start", { method: "POST", body: JSON.stringify({ mfaToken: start.mfaToken }) }));
      });
    }
  }

  function verify(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const { user } = await apiFetch<{ user: { mustResetPassword: boolean } }>("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ mfaToken: start.mfaToken, method: view, code }),
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

      {view === "choose" ? (
        <>
          <h2 className="text-2xl font-bold text-chs-charcoal">Set up sign-in protection</h2>
          <p className="mt-1 text-sm text-gray-500">
            Every CHS account now needs a second step at sign-in. Choose how you'll get your 6-digit codes.
          </p>
          <div className="mt-6 space-y-3">
            <MethodButton
              icon={<Mail size={20} />}
              title="Email me a code"
              detail={`Sent to ${start.maskedEmail} each time you sign in.`}
              onClick={chooseEmail}
            />
            <MethodButton
              icon={<Smartphone size={20} />}
              title="Authenticator app"
              detail="Microsoft Authenticator, Google Authenticator, Authy or similar."
              onClick={chooseApp}
            />
          </div>
        </>
      ) : (
        <form onSubmit={verify} className="space-y-5">
          {view === "EMAIL" ? (
            <div>
              <h2 className="text-2xl font-bold text-chs-charcoal">Check your email</h2>
              <p className="mt-1 text-sm text-gray-500">
                {emailSentAt ? `We sent a 6-digit code to ${start.maskedEmail}. It expires in 10 minutes.` : "Sending your code..."}
              </p>
            </div>
          ) : enrolling ? (
            <div>
              <h2 className="text-2xl font-bold text-chs-charcoal">Link your authenticator app</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-500">
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
            </div>
          ) : (
            <div>
              <h2 className="text-2xl font-bold text-chs-charcoal">Enter your app code</h2>
              <p className="mt-1 text-sm text-gray-500">Open your authenticator app and enter the 6-digit code for CHS Employee Portal.</p>
            </div>
          )}

          <CodeInput value={code} onChange={setCode} />

          {error ? <div className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}

          <button type="submit" disabled={busy || code.length !== 6} className={AUTH_SUBMIT_CLASS}>
            <ShieldCheck size={16} />
            {busy ? "Checking..." : enrolling ? "Verify & finish setup" : "Verify"}
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            {view === "EMAIL" ? (
              <button type="button" disabled={busy || resendIn > 0} onClick={sendEmail} className="font-medium text-chs-charcoal hover:underline disabled:text-gray-400 disabled:no-underline">
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={chooseEmail} className="font-medium text-chs-charcoal hover:underline">
                Email me a code instead
              </button>
            )}
            {enrolling ? (
              <button type="button" onClick={() => { setView("choose"); setError(null); }} className="text-gray-500 hover:underline">
                Choose another method
              </button>
            ) : view === "EMAIL" && start.totpAvailable ? (
              <button type="button" onClick={() => { setView("TOTP"); setCode(""); setError(null); }} className="text-gray-500 hover:underline">
                Use authenticator app
              </button>
            ) : null}
          </div>
        </form>
      )}

      {view === "choose" && error ? <div className="mt-4 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</div> : null}

      <p className="mt-6 text-center text-sm">
        <button type="button" onClick={onCancel} className="text-gray-500 hover:underline">
          Back to sign in
        </button>
      </p>
    </div>
  );
}

function MethodButton({ icon, title, detail, onClick }: { icon: React.ReactNode; title: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl border border-gray-200 p-4 text-left transition-colors hover:border-chs-gold hover:bg-chs-gold/5"
    >
      <span className="mt-0.5 text-chs-charcoal">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-chs-charcoal">{title}</span>
        <span className="mt-0.5 block text-xs text-gray-500">{detail}</span>
      </span>
    </button>
  );
}
