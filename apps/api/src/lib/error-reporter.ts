// Dependency-injected error reporter. Keeps apps/api free of any @sentry/nextjs
// dependency (preserving single-test isolation and runtime portability): the web
// layer's server instrumentation injects a reporter that forwards to Sentry, while
// tests and standalone usage leave it unset (no-op).

type ErrorReporter = (err: unknown, context?: Record<string, unknown>) => void;

let reporter: ErrorReporter | null = null;

export function setErrorReporter(fn: ErrorReporter | null): void {
  reporter = fn;
}

export function reportError(err: unknown, context?: Record<string, unknown>): void {
  reporter?.(err, context);
}
