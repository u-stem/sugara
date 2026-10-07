import { cleanupOrphanedCoverImages } from "../lib/cleanup-orphan-covers";

// Dry-run unless --apply is passed: deleting Storage objects is irreversible, so the
// operator must review the listed paths first.
async function main() {
  const apply = process.argv.includes("--apply");
  const { orphans, deleted } = await cleanupOrphanedCoverImages({ apply });

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
  console.error("Orphan cover cleanup failed:", err);
  process.exit(1);
});
