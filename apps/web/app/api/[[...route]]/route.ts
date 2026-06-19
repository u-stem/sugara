import { app } from "@sugara/api";
import { handle } from "hono/vercel";

export const preferredRegion = "hnd1";

// Ceiling (not a fixed runtime) so the daily weather cron, which fetches ~58 JMA
// offices in small concurrent batches, has headroom even if several offices hit
// their per-request timeout. Normal requests finish in well under a second.
export const maxDuration = 60;

const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
