import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isApiKeyExpired } from "../api-key-utils";

describe("isApiKeyExpired", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns true when the expiry timestamp is in the past", () => {
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    expect(isApiKeyExpired("2026-06-09T12:00:00Z")).toBe(true);
  });

  it("returns false when the expiry timestamp is in the future", () => {
    vi.setSystemTime(new Date("2026-06-10T12:00:00Z"));
    expect(isApiKeyExpired("2026-06-11T12:00:00Z")).toBe(false);
  });
});
