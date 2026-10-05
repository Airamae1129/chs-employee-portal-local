"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell, LoginSplit } from "@/components/LoginSplit";
import { MfaChallenge, MfaStart } from "@/components/MfaChallenge";
import { apiFetch, ApiError } from "@/lib/api";

/**
 * Single sign-in page for every role. The password step returns an MFA
 * challenge rather than a session; only after the second factor (or
 * first-time MFA setup) does the backend issue the session, with the
 * account's real role + mustResetPassword. The dashboard shell
 * (lib/nav.ts) adapts to the role automatically.
 */
export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfa, setMfa] = useState<MfaStart | null>(null);

  async function handleSubmit(email: string, password: string) {
    setSubmitting(true);
    setError(null);
    try {
      setMfa(
        await apiFetch<MfaStart>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        })
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (mfa) {
    return (
      <AuthShell>
        <MfaChallenge
          start={mfa}
          onVerified={(user) => router.push(user.mustResetPassword ? "/set-password" : "/dashboard")}
          onCancel={() => setMfa(null)}
        />
      </AuthShell>
    );
  }

  return <LoginSplit onSubmit={handleSubmit} submitting={submitting} error={error} />;
}
