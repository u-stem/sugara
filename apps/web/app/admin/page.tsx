import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import AdminClient from "./_components/admin-client";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();
  const baseUrl = process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3000";

  // Server-side admin authorization: non-admin users never receive client code.
  // Scope the try to the fetch only, so a network failure resolves to a null
  // response — otherwise notFound()'s internal throw would be swallowed by the
  // catch and re-fired, blurring "request failed" and "intentional not-found".
  const res = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { cookie: cookieHeader },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);

  // Fail closed: only a 200 proves the caller is an authorized admin. 429 (rate
  // limit), 5xx, and network failures say nothing about authorization, so treat
  // any non-OK response as not-found rather than rendering the admin shell.
  if (!res?.ok) {
    notFound();
  }

  return <AdminClient />;
}
