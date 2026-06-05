import * as Sentry from "@sentry/nextjs";
import { IGNORE_ERRORS, beforeBreadcrumb, beforeSend } from "./lib/sentry-options";

// Browser Sentry init (Next.js 16 client instrumentation). Skipped when no DSN is
// set so local dev / tests do not send events.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    ignoreErrors: IGNORE_ERRORS,
    beforeSend,
    beforeBreadcrumb,
  });
}

// Required by @sentry/nextjs to suppress a build-time warning. With
// removeTracing enabled this is a no-op (no BrowserTracing integration).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
