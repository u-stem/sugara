import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { IGNORE_ERRORS, beforeBreadcrumb, beforeSend } from "./lib/sentry-options";

// Disable Zod's JIT path on the browser. Zod probes `new Function("")` to enable a
// compiled validator, but our production CSP omits `unsafe-eval`, so the probe is
// blocked. The throw is swallowed (Zod falls back to the interpreter), yet the
// browser still reports it as a `securitypolicyviolation`. `jitless` skips the probe
// entirely, silencing the console warning with no functional/perf loss (the JIT path
// was already unavailable under the CSP).
z.config({ jitless: true });

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
