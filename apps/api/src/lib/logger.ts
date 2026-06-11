import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info"),
  // Vercel adds timestamps automatically; avoid duplication
  timestamp: false,
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Prevent credentials and key material from leaking into log streams.
  // This is a defence-in-depth measure: code should never log these values
  // directly, but the redact layer catches accidental inclusions.
  redact: {
    paths: [
      "req.headers.authorization",
      "*.authorization",
      "*.apiKey",
      "*.rawKey",
      "*.token",
      "*.key",
    ],
    censor: "[REDACTED]",
  },
});
