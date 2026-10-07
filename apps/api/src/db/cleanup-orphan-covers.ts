import { cleanupOrphanedCoverImages } from "../lib/cleanup-orphan-covers";
import { env } from "../lib/env";
import { checkSameEnvironment } from "../lib/storage-environment";

// Must match the default in lib/storage.ts so the check sees the URL the client uses.
const DEFAULT_SUPABASE_URL = "http://127.0.0.1:55321";

// Dry-run unless --apply is passed: deleting Storage objects is irreversible, so the
// operator must review the listed paths first. --force additionally lifts the
// ratio / zero-reference guards and is only honoured together with --apply.
async function main() {
  const apply = process.argv.includes("--apply");
  const force = process.argv.includes("--force");

  const databaseUrl = env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const environment = checkSameEnvironment(databaseUrl, supabaseUrl);

  // A mismatch aborts even a dry-run: its output would list every object as an orphan.
  if (environment.kind === "mismatch") {
    console.error(`Environment mismatch: ${environment.reason}`);
    process.exit(1);
  }
  if (environment.kind === "unknown") {
    if (apply) {
      console.error(
        `Cannot verify that the database and Storage are the same environment: ${environment.reason}`,
      );
      console.error("Refusing --apply. Use a Supabase URL form the check understands.");
      process.exit(1);
    }
    console.warn(`Warning: environment not verified (${environment.reason})`);
  }

  const { orphans, deleted } = await cleanupOrphanedCoverImages({ apply, force });

  for (const path of orphans) {
    console.log(path);
  }
  if (apply) {
    console.log(`Deleted ${deleted} orphaned cover image(s)`);
  } else {
    console.log(`Found ${orphans.length} orphaned cover image(s) (dry-run, nothing deleted)`);
    console.log("Re-run with --apply to delete them");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Orphan cover cleanup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
