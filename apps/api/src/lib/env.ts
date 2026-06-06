function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function withDefault(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

// Use getters so tests can stub process.env and have the changes reflected
export const env = {
  get DATABASE_URL() {
    return withDefault("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:55322/postgres");
  },
  get BETTER_AUTH_BASE_URL() {
    return withDefault("BETTER_AUTH_BASE_URL", "http://localhost:3000");
  },
  get BETTER_AUTH_SECRET() {
    return required("BETTER_AUTH_SECRET");
  },
  get FRONTEND_URL() {
    return withDefault("FRONTEND_URL", "http://localhost:3000");
  },
  get GITHUB_TOKEN() {
    return process.env.GITHUB_TOKEN;
  },
  get GITHUB_FEEDBACK_REPO() {
    return process.env.GITHUB_FEEDBACK_REPO;
  },
  // Sentry-originated issues land in the same private repo by default; override
  // GITHUB_SENTRY_REPO only if they should be split out from user feedback.
  get GITHUB_SENTRY_REPO() {
    return process.env.GITHUB_SENTRY_REPO ?? process.env.GITHUB_FEEDBACK_REPO;
  },
  get SENTRY_WEBHOOK_SECRET() {
    return process.env.SENTRY_WEBHOOK_SECRET;
  },
  get VAPID_PUBLIC_KEY() {
    return withDefault("VAPID_PUBLIC_KEY", "");
  },
  get VAPID_PRIVATE_KEY() {
    return withDefault("VAPID_PRIVATE_KEY", "");
  },
  get VAPID_SUBJECT() {
    return withDefault("VAPID_SUBJECT", "mailto:admin@sugara.app");
  },
  get GMAIL_USER() {
    return required("GMAIL_USER");
  },
  get GMAIL_APP_PASSWORD() {
    return required("GMAIL_APP_PASSWORD");
  },
  // Vercel's Upstash Marketplace integration injects KV-style names
  // (`UPSTASH_REDIS_KV_REST_API_*`) rather than the `@upstash/redis` defaults.
  // Use the read-write token, not the READ_ONLY one — rate limiting does INCR.
  get UPSTASH_REDIS_REST_URL() {
    return process.env.UPSTASH_REDIS_KV_REST_API_URL;
  },
  get UPSTASH_REDIS_REST_TOKEN() {
    return process.env.UPSTASH_REDIS_KV_REST_API_TOKEN;
  },
};
