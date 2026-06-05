import { setErrorReporter } from "@sugara/api/lib/error-reporter";
import * as Sentry from "@sentry/nextjs";
import { IGNORE_ERRORS, beforeBreadcrumb, beforeSend } from "./lib/sentry-options";

// Server/edge Sentry init. The Hono API runs as a Next.js route handler in the
// same Node runtime, so this init also covers API errors. The API stays free of
// any @sentry/nextjs dependency: we inject a reporter into its DI hook here.
export async function register() {
  const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  const runtime = process.env.NEXT_RUNTIME;
  if (runtime !== "nodejs" && runtime !== "edge") return;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend,
    beforeBreadcrumb,
  });

  // Hono's onError returns 500 as a normal Response, so Next's onRequestError
  // does not fire for handled API errors. Forward them explicitly via the DI hook.
  setErrorReporter((err, context) => {
    Sentry.captureException(err, context ? { extra: context } : undefined);
  });
}

// Captures errors thrown in RSC / route handlers (Next.js 16 instrumentation hook).
export const onRequestError = Sentry.captureRequestError;
