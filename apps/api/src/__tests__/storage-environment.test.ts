import { describe, expect, it } from "vitest";
import { checkSameEnvironment } from "../lib/storage-environment";

const DB_DIRECT = "postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
const DB_POOLER =
  "postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres";
const DB_LOCAL = "postgresql://postgres:postgres@127.0.0.1:55322/postgres";
const API_PROD = "https://abcdefghijklmnopqrst.supabase.co";
const API_OTHER = "https://zzzzzzzzzzzzzzzzzzzz.supabase.co";
const API_LOCAL = "http://127.0.0.1:55321";

describe("checkSameEnvironment", () => {
  it("matches a direct DB host and API URL with the same project ref", () => {
    expect(checkSameEnvironment(DB_DIRECT, API_PROD).kind).toBe("match");
  });

  it("matches a pooler DB user (postgres.<ref>) and API URL with the same project ref", () => {
    expect(checkSameEnvironment(DB_POOLER, API_PROD).kind).toBe("match");
  });

  it("matches when both sides are local", () => {
    expect(checkSameEnvironment(DB_LOCAL, API_LOCAL).kind).toBe("match");
  });

  it("treats localhost as local", () => {
    expect(
      checkSameEnvironment("postgresql://u:p@localhost:5432/db", "http://localhost:55321").kind,
    ).toBe("match");
  });

  it("reports a mismatch when the direct DB ref differs from the API ref", () => {
    expect(checkSameEnvironment(DB_DIRECT, API_OTHER).kind).toBe("mismatch");
  });

  it("reports a mismatch when the pooler DB ref differs from the API ref", () => {
    expect(checkSameEnvironment(DB_POOLER, API_OTHER).kind).toBe("mismatch");
  });

  it("reports a mismatch for a local DB with a remote API", () => {
    expect(checkSameEnvironment(DB_LOCAL, API_PROD).kind).toBe("mismatch");
  });

  it("reports a mismatch for a remote DB with a local API", () => {
    expect(checkSameEnvironment(DB_DIRECT, API_LOCAL).kind).toBe("mismatch");
  });

  it("is unknown when the DB host is not a recognised Supabase form", () => {
    expect(
      checkSameEnvironment("postgresql://u:p@db.internal.example.com:5432/db", API_PROD).kind,
    ).toBe("unknown");
  });

  it("is unknown when the pooler user has no project ref", () => {
    expect(
      checkSameEnvironment(
        "postgresql://postgres:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres",
        API_PROD,
      ).kind,
    ).toBe("unknown");
  });

  it("is unknown when the API URL is a custom domain", () => {
    expect(checkSameEnvironment(DB_DIRECT, "https://api.example.com").kind).toBe("unknown");
  });

  it("is unknown when a URL cannot be parsed", () => {
    expect(checkSameEnvironment("not a url", API_PROD).kind).toBe("unknown");
  });
});
