import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey } from "./api-key";

describe("hashApiKey", () => {
  it("returns a 64-char lowercase hex digest", () => {
    expect(hashApiKey("sk_test")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    expect(hashApiKey("sk_abc")).toBe(hashApiKey("sk_abc"));
  });

  it("differs for different input", () => {
    expect(hashApiKey("sk_a")).not.toBe(hashApiKey("sk_b"));
  });
});

describe("generateApiKey", () => {
  it("prefixes the raw key with sk_", () => {
    expect(generateApiKey().rawKey.startsWith("sk_")).toBe(true);
  });

  it("stores only the hash of the raw key", () => {
    const { rawKey, keyHash } = generateApiKey();
    expect(keyHash).toBe(hashApiKey(rawKey));
  });

  it("derives start as a prefix of the raw key", () => {
    const { rawKey, start } = generateApiKey();
    expect(rawKey.startsWith(start)).toBe(true);
  });

  it("keeps start within the column width", () => {
    expect(generateApiKey().start.length).toBeLessThanOrEqual(16);
  });

  it("generates a unique key each call", () => {
    expect(generateApiKey().rawKey).not.toBe(generateApiKey().rawKey);
  });
});
