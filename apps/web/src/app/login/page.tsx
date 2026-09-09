"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoginSplit } from "@/components/LoginSplit";
import { apiFetch, ApiError } from "@/lib/api";

/**
 * Single sign-in page for every role. The backend authenticates on
 * email/password alone and returns the account's real role +
 * mustResetPassword; the dashboard shell (lib/nav.ts) adapts to the
 * role automatically, so there's nothing else to branch on here.
 */
export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(email: string, password: string) {
    setSubmitting(true);
    setError(null);
    try {
      const { user } = await apiFetch<{ user: { mustResetPassword: boolean } }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      router.push(user.mustResetPassword ? "/set-password" : "/dashboard");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return <LoginSplit onSubmit={handleSubmit} submitting={submitting} error={error} />;
}
