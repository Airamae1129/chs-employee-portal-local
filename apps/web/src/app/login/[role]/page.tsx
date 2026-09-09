import { redirect } from "next/navigation";

// The three role-specific entry points have been consolidated into a
// single /login page (the backend resolves the account's real role on
// sign-in) — old bookmarks/links to /login/employee|manager|admin still
// land somewhere sensible instead of 404ing.
export default function LegacyRoleLoginPage() {
  redirect("/login");
}
