// Guards the orphan sweep against pairing one environment's database with another's
// Storage: against a mismatched pair every object looks unreferenced.

export type EnvironmentCheck =
  | { kind: "match" }
  | { kind: "mismatch"; reason: string }
  | { kind: "unknown"; reason: string };

type Origin =
  | { kind: "local" }
  | { kind: "ref"; ref: string }
  | { kind: "unknown"; reason: string };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

// https://<ref>.supabase.co
function originOfApiUrl(raw: string): Origin {
  const url = parseUrl(raw);
  if (!url) return { kind: "unknown", reason: "NEXT_PUBLIC_SUPABASE_URL is not a valid URL" };
  if (LOCAL_HOSTS.has(url.hostname)) return { kind: "local" };
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (match) return { kind: "ref", ref: match[1] };
  return {
    kind: "unknown",
    reason: `cannot extract a project ref from the Supabase URL host "${url.hostname}"`,
  };
}

// Direct: host db.<ref>.supabase.co. Pooler: user postgres.<ref> on *.pooler.supabase.com.
function originOfDatabaseUrl(raw: string): Origin {
  const url = parseUrl(raw);
  if (!url) return { kind: "unknown", reason: "DATABASE_URL is not a valid URL" };
  if (LOCAL_HOSTS.has(url.hostname)) return { kind: "local" };

  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (direct) return { kind: "ref", ref: direct[1] };

  if (url.hostname.endsWith(".pooler.supabase.com")) {
    const user = /^postgres\.([a-z0-9]+)$/.exec(decodeURIComponent(url.username));
    if (user) return { kind: "ref", ref: user[1] };
    return { kind: "unknown", reason: "pooler DATABASE_URL user is not in postgres.<ref> form" };
  }

  return {
    kind: "unknown",
    reason: `cannot extract a project ref from the DATABASE_URL host "${url.hostname}"`,
  };
}

export function checkSameEnvironment(databaseUrl: string, supabaseUrl: string): EnvironmentCheck {
  const db = originOfDatabaseUrl(databaseUrl);
  const api = originOfApiUrl(supabaseUrl);

  if (db.kind === "unknown") return { kind: "unknown", reason: db.reason };
  if (api.kind === "unknown") return { kind: "unknown", reason: api.reason };

  if (db.kind === "local" && api.kind === "local") return { kind: "match" };
  if (db.kind === "local" || api.kind === "local") {
    return {
      kind: "mismatch",
      reason: "one of DATABASE_URL / NEXT_PUBLIC_SUPABASE_URL is local and the other is not",
    };
  }
  if (db.ref !== api.ref) {
    return {
      kind: "mismatch",
      reason: `DATABASE_URL project ref (${db.ref}) differs from NEXT_PUBLIC_SUPABASE_URL (${api.ref})`,
    };
  }
  return { kind: "match" };
}
