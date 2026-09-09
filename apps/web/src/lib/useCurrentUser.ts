"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiError } from "./api";
import { CurrentUser } from "./types";

/**
 * Client-side auth guard for everything under (dashboard). We don't
 * verify the JWT in Next.js middleware (that would mean duplicating
 * JWT_SECRET into the web app) — instead every dashboard page mounts
 * this hook, which calls GET /me. A 401 means no/expired session, so
 * we bounce back to the employee login. Section 9's 12h session expiry
 * is enforced server-side either way.
 */
export function useCurrentUser() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ user: CurrentUser }>("/me")
      .then((data) => {
        if (cancelled) return;
        if (data.user.mustResetPassword) {
          router.replace("/set-password");
          return;
        }
        setUser(data.user);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/login");
        } else {
          setError(e.message ?? "Failed to load session");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return { user, loading, error };
}
