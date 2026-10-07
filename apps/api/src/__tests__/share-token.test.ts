import { isShareToken } from "@sugara/shared";
import { describe, expect, it } from "vitest";
import { deriveShareChannelKey, generateShareToken, omitShareSecrets } from "../lib/share-token";

describe("generateShareToken", () => {
  it("generates a 43-character token (32 bytes base64url)", () => {
    const token = generateShareToken();
    expect(token).toHaveLength(43);
  });

  it("uses only base64url characters", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates tokens the web pages accept (isShareToken)", () => {
    const tokens = Array.from({ length: 200 }, generateShareToken);
    expect(tokens.every(isShareToken)).toBe(true);
  });

  it("generates unique tokens", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateShareToken));
    expect(tokens.size).toBe(100);
  });
});

describe("deriveShareChannelKey", () => {
  it("returns the SHA-256 hex digest of the token", () => {
    // sha256("abc")
    expect(deriveShareChannelKey("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("is deterministic for the same token", () => {
    const token = generateShareToken();
    expect(deriveShareChannelKey(token)).toBe(deriveShareChannelKey(token));
  });

  it("differs per token", () => {
    expect(deriveShareChannelKey("token-a")).not.toBe(deriveShareChannelKey("token-b"));
  });

  it("does not embed the token", () => {
    const token = generateShareToken();
    expect(deriveShareChannelKey(token)).not.toContain(token);
  });
});

describe("omitShareSecrets", () => {
  it("removes shareToken and shareTokenExpiresAt and keeps other fields", () => {
    const trip = { id: "t1", title: "A", shareToken: "secret", shareTokenExpiresAt: new Date() };

    expect(omitShareSecrets(trip)).toEqual({ id: "t1", title: "A" });
  });
});
