import { z } from "zod";

const envSchema = z.object({
  SUGARA_API_KEY: z.string().min(1),
  SUGARA_API_URL: z.string().url(),
});

export type ParsedEnv = {
  apiKey: string;
  baseUrl: string;
};

/**
 * Parses and validates required environment variables.
 * Writes a human-readable error to stderr and exits if any required variable is
 * missing or invalid. Never includes the API key value in error output.
 *
 * @param env - environment variable map (defaults to process.env)
 */
export function parseEnv(env: Record<string, string | undefined> = process.env): ParsedEnv {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => String(issue.path[0])).join(", ");
    process.stderr.write(
      `[sugara-mcp] Configuration error: required environment variable(s) missing or invalid: ${fields}\n`,
    );
    process.stderr.write(
      "[sugara-mcp] Please set SUGARA_API_KEY and SUGARA_API_URL before starting the server.\n",
    );
    process.exit(1);
  }
  // Normalize: strip trailing slash so callers can always append /api/v1/...
  const baseUrl = result.data.SUGARA_API_URL.replace(/\/$/, "");
  return { apiKey: result.data.SUGARA_API_KEY, baseUrl };
}
