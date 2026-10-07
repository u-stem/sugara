import { isNotNull } from "drizzle-orm";
import { db } from "../db/index";
import { trips } from "../db/schema";
import { extractStoragePath, listCoverImageObjects, removeCoverImagePaths } from "./storage";

// Uploads write the Storage object first and the trips row afterwards, so a fresh
// object legitimately has no reference for a short time. Skipping anything younger
// than this keeps the sweep from racing an in-flight upload or duplicate.
export const ORPHAN_MIN_AGE_MS = 60 * 60 * 1000;

export interface OrphanCleanupResult {
  orphans: string[];
  deleted: number;
}

// Find cover images in Storage that no trip references (left behind by deletions that
// predate cleanup-on-delete, or by Storage failures during deletion) and, when `apply`
// is true, remove them. `apply` is required (no default) so no caller deletes by omission.
export async function cleanupOrphanedCoverImages(options: {
  apply: boolean;
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

  const orphans = objects
    // Unknown creation time: cannot prove the object is old enough, so keep it.
    .filter((o) => o.createdAt !== null && o.createdAt.getTime() <= cutoff)
    .filter((o) => !referenced.has(o.path))
    .map((o) => o.path);

  if (!options.apply || orphans.length === 0) {
    return { orphans, deleted: 0 };
  }

  await removeCoverImagePaths(orphans);
  return { orphans, deleted: orphans.length };
}
