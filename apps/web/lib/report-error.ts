import { captureException } from "@sentry/nextjs";

// Report an error to Sentry. Safe to call when Sentry is not initialized
// (DSN unset) — the SDK no-ops. Use for caught errors that the UI handles but
// that should still be visible in monitoring (see isExpectedClientError to skip
// expected 4xx). Components should prefer this over importing Sentry directly.
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  captureException(err, context ? { extra: context } : undefined);
}
