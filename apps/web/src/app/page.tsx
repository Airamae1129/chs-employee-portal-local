import { redirect } from "next/navigation";

// Root lands on the single login page — see Section 4.2. Users who
// already have a session cookie get bounced onward to /dashboard by
// the (dashboard) layout's client-side auth check.
export default function RootPage() {
  redirect("/login");
}
