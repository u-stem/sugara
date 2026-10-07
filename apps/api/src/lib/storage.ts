import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ERROR_MSG } from "./constants";
import { logger } from "./logger";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:55321";

let _supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
    }
    _supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return _supabaseAdmin;
}

export const TRIP_COVERS_BUCKET = "trip-covers";
const MAX_FILE_SIZE = 3 * 1024 * 1024; // 3MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const EXT_MAP: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function validateCoverImage(file: { type: string; size: number }): string | null {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return ERROR_MSG.FILE_TYPE_NOT_ALLOWED;
  }
  if (file.size > MAX_FILE_SIZE) {
    return ERROR_MSG.FILE_TOO_LARGE;
  }
  return null;
}

export async function uploadCoverImage(
  tripId: string,
  file: Buffer,
  contentType: string,
): Promise<string> {
  const ext = EXT_MAP[contentType] || "jpg";
  const path = `${tripId}/${Date.now()}.${ext}`;

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage
    .from(TRIP_COVERS_BUCKET)
    .upload(path, file, { contentType, upsert: false });

  if (error) {
    throw new Error(`Storage upload failed: ${error.message}`);
  }

  const { data } = supabaseAdmin.storage.from(TRIP_COVERS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

const SUPABASE_STORAGE_PATH_PREFIX = `/storage/v1/object/public/${TRIP_COVERS_BUCKET}/`;

/**
 * Extract the storage path from a Supabase public URL.
 * Returns null if the URL does not originate from the expected bucket.
 */
export function extractStoragePath(url: string): string | null {
  const idx = url.indexOf(SUPABASE_STORAGE_PATH_PREFIX);
  if (idx === -1) return null;
  const path = url.slice(idx + SUPABASE_STORAGE_PATH_PREFIX.length);
  // Prevent path traversal
  if (!path || path.includes("..")) return null;
  return path;
}

/**
 * Copy a cover image to a new trip's directory.
 * Returns the new public URL, or null if the copy failed.
 */
export async function copyCoverImage(
  sourceUrl: string,
  destTripId: string,
): Promise<string | null> {
  const sourcePath = extractStoragePath(sourceUrl);
  if (!sourcePath) return null;

  const ext = sourcePath.split(".").pop() || "jpg";
  const destPath = `${destTripId}/${Date.now()}.${ext}`;

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage.from(TRIP_COVERS_BUCKET).copy(sourcePath, destPath);

  if (error) {
    logger.error({ err: error.message }, "Storage copy failed");
    return null;
  }

  const { data } = supabaseAdmin.storage.from(TRIP_COVERS_BUCKET).getPublicUrl(destPath);
  return data.publicUrl;
}

export async function deleteCoverImage(url: string): Promise<void> {
  const path = extractStoragePath(url);
  if (!path) return;

  const supabaseAdmin = getSupabaseAdmin();
  const { error } = await supabaseAdmin.storage.from(TRIP_COVERS_BUCKET).remove([path]);

  if (error) {
    logger.error({ err: error.message }, "Storage delete failed");
  }
}

// Supabase Storage accepts many paths per remove() call, but keeping batches small
// bounds the blast radius of a failed request and the request body size.
const REMOVE_BATCH_SIZE = 100;
const LIST_PAGE_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function removePaths(paths: string[]): Promise<void> {
  const { error } = await getSupabaseAdmin().storage.from(TRIP_COVERS_BUCKET).remove(paths);
  if (error) {
    throw new Error(`Storage delete failed: ${error.message}`);
  }
}

/**
 * Remove objects by storage path. Throws on the first failed batch so callers that
 * must know about partial failure (the orphan sweep) can abort.
 */
export async function removeCoverImagePaths(paths: string[]): Promise<void> {
  for (const batch of chunk(paths, REMOVE_BATCH_SIZE)) {
    await removePaths(batch);
  }
}

/**
 * Best-effort bulk delete of cover images by public URL. Never throws.
 *
 * Callers delete the owning DB rows first and call this afterwards: if Storage fails
 * the user's data is already gone (the deletion the user asked for succeeded) and the
 * leftover objects are unreferenced orphans that the `db:cleanup-orphan-covers` sweep
 * reclaims. The opposite order could remove images for rows that then fail to delete.
 */
export async function deleteCoverImages(urls: string[]): Promise<void> {
  const paths = new Set<string>();
  for (const url of urls) {
    const path = extractStoragePath(url);
    if (path) paths.add(path);
  }

  for (const batch of chunk([...paths], REMOVE_BATCH_SIZE)) {
    try {
      await removePaths(batch);
    } catch (err) {
      logger.error({ err, count: batch.length }, "Storage bulk delete of cover images failed");
    }
  }
}

export interface CoverImageObject {
  path: string;
  /** null when Storage did not report a creation time */
  createdAt: Date | null;
}

async function listFolder(prefix: string, found: CoverImageObject[]): Promise<void> {
  const supabaseAdmin = getSupabaseAdmin();
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await supabaseAdmin.storage.from(TRIP_COVERS_BUCKET).list(prefix, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      throw new Error(`Storage list failed: ${error.message}`);
    }

    for (const entry of data) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        // list() reports folders (the per-trip prefixes) with a null id
        await listFolder(entryPath, found);
      } else {
        found.push({
          path: entryPath,
          createdAt: entry.created_at ? new Date(entry.created_at) : null,
        });
      }
    }

    if (data.length < LIST_PAGE_SIZE) return;
  }
}

/**
 * List every object in the cover bucket. Throws if any page fails, so a partial
 * listing is never mistaken for the full set.
 */
export async function listCoverImageObjects(): Promise<CoverImageObject[]> {
  const found: CoverImageObject[] = [];
  await listFolder("", found);
  return found;
}
