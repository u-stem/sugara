import { describe, expect, it } from "vitest";
import { isShareToken } from "../share-token";

describe("isShareToken", () => {
  it("accepts 43 base64url characters", () => {
    expect(isShareToken("Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE")).toBe(true);
  });

  it("accepts underscores and hyphens", () => {
    expect(isShareToken("_-".repeat(21) + "a")).toBe(true);
  });

  it("rejects a path traversal value", () => {
    expect(isShareToken("../admin/users")).toBe(false);
  });

  it("rejects an encoded slash", () => {
    expect(isShareToken(`${"a".repeat(40)}%2F..`)).toBe(false);
  });

  it("rejects a value that is too short", () => {
    expect(isShareToken("a".repeat(42))).toBe(false);
  });

  it("rejects a value that is too long", () => {
    expect(isShareToken("a".repeat(44))).toBe(false);
  });

  it("rejects padding characters", () => {
    expect(isShareToken(`${"a".repeat(42)}=`)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isShareToken("")).toBe(false);
  });

  it("rejects a trailing newline", () => {
    expect(isShareToken(`${"a".repeat(43)}\n`)).toBe(false);
  });
});
