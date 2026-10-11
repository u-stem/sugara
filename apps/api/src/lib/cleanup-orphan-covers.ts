import { isNotNull } from "drizzle-orm";
import { db } from "../db/index";
import { trips } from "../db/schema";
import { extractStoragePath, listCoverImageObjects, removeCoverImagePaths } from "./storage";

// Uploads write the Storage object first and the trips row afterwards, so a fresh
// object legitimately has no reference for a short time. Skipping anything younger
// than this keeps the sweep from racing an in-flight upload or duplicate.
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

// Deleting more than this share of the eligible objects is far more likely to mean a
// wrong DB/Storage pairing or a failed query than a real backlog of orphans.
export const MAX_ORPHAN_RATIO = 0.5;

export interface OrphanCleanupResult {
  orphans: string[];
  deleted: number;
}

export class OrphanSweepGuardError extends Error {}

// Find cover images in Storage that no trip references (left behind by deletions that
// predate cleanup-on-delete, or by Storage failures during deletion) and, when `apply`
// is true, remove them. `apply` is required (no default) so no caller deletes by omission.
export async function cleanupOrphanedCoverImages(options: {
  apply: boolean;
  // Bypasses the ratio / zero-reference guards. Only meaningful together with `apply`.
  force?: boolean;
  now?: Date;
}): Promise<OrphanCleanupResult> {
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - ORPHAN_MIN_AGE_MS;

  // List Storage before reading references: an object uploaded after the listing is
  // not a candidate, and one referenced after the listing is still seen as referenced.
  const objects = await listCoverImageObjects();

  const rows = await db
    .select({ url: trips.coverImageUrl })
    .from(trips)
    .where(isNotNull(trips.coverImageUrl));
  const referenced = new Set<string>();
  for (const row of rows) {
    const path = row.url ? extractStoragePath(row.url) : null;
    if (path) referenced.add(path);
  }

  // Unknown creation time: cannot prove the object is old enough, so keep it.
  const eligible = objects.filter((o) => o.createdAt !== null && o.createdAt.getTime() <= cutoff);
  const orphans = eligible.filter((o) => !referenced.has(o.path)).map((o) => o.path);

  if (!options.apply || orphans.length === 0) {
    return { orphans, deleted: 0 };
  }

  if (!options.force) {
    if (referenced.size === 0) {
      throw new OrphanSweepGuardError(
        `Refusing to delete: no trip references any cover image but the bucket has ${orphans.length} candidate object(s). ` +
          "This usually means DATABASE_URL points at the wrong database. Re-run with --force only if that is intended.",
      );
    }
    if (orphans.length / eligible.length > MAX_ORPHAN_RATIO) {
      throw new OrphanSweepGuardError(
        `Refusing to delete: ${orphans.length} of ${eligible.length} eligible object(s) look orphaned, which exceeds ${MAX_ORPHAN_RATIO * 100}%. ` +
          "Check that DATABASE_URL and the Supabase project are the same environment. Re-run with --apply --force only if this is intended.",
      );
    }
  }

  await removeCoverImagePaths(orphans);
  return { orphans, deleted: orphans.length };
}
