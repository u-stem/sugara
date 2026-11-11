import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env";
import * as schema from "./schema";

const connectionString = env.DATABASE_URL;

// Supabase requires SSL for external connections (non-localhost)
const isLocalhost =
  connectionString.includes("localhost") || connectionString.includes("127.0.0.1");
const client = postgres(connectionString, {
  ssl: isLocalhost ? false : "require",
  max: isLocalhost ? 10 : 3,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  // Prevent indefinite hang when the pooler rejects or queues connections
  connect_timeout: 10,
  // postgres.js 4 pipelines up to 100 queries per connection by default, and Supavisor
  // before 2.10 (the transaction pooler on :6543) never answers pipelined queries, so
  // every request would hang. Send one query at a time per connection.
  max_pipeline: 1,
});
export const db = drizzle(client, { schema });
