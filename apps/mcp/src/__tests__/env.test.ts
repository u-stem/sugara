import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../env.js";

describe("parseEnv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed env when both variables are present", () => {
    // Arrange
    const env = {
      SUGARA_API_KEY: "sk_test_key",
      SUGARA_API_URL: "https://example.com",
    };

    // Act
    const result = parseEnv(env);

    // Assert
    expect(result.apiKey).toBe("sk_test_key");
    expect(result.baseUrl).toBe("https://example.com");
  });

  it("strips trailing slash from SUGARA_API_URL", () => {
    // Arrange
    const env = {
      SUGARA_API_KEY: "sk_test_key",
      SUGARA_API_URL: "https://example.com/",
    };

    // Act
    const result = parseEnv(env);

    // Assert
    expect(result.baseUrl).toBe("https://example.com");
  });

  it("exits with code 1 when SUGARA_API_KEY is missing", () => {
    // Arrange
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const env = { SUGARA_API_URL: "https://example.com" };

    // Act + Assert
    expect(() => parseEnv(env)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when SUGARA_API_URL is missing", () => {
    // Arrange
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const env = { SUGARA_API_KEY: "sk_test_key" };

    // Act + Assert
    expect(() => parseEnv(env)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when SUGARA_API_URL is not a valid URL", () => {
    // Arrange
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const env = { SUGARA_API_KEY: "sk_test_key", SUGARA_API_URL: "not-a-url" };

    // Act + Assert
    expect(() => parseEnv(env)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits with code 1 when SUGARA_API_URL uses http for an external host", () => {
    // Arrange
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((_code) => {
      throw new Error("process.exit called");
    });
    const env = { SUGARA_API_KEY: "sk_test_key", SUGARA_API_URL: "http://example.com" };

    // Act + Assert
    expect(() => parseEnv(env)).toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("accepts http for localhost", () => {
    // Arrange
    const env = {
      SUGARA_API_KEY: "sk_test_key",
      SUGARA_API_URL: "http://localhost:3000",
    };

    // Act
    const result = parseEnv(env);

    // Assert
    expect(result.baseUrl).toBe("http://localhost:3000");
  });

  it("accepts http for 127.0.0.1", () => {
    // Arrange
    const env = {
      SUGARA_API_KEY: "sk_test_key",
      SUGARA_API_URL: "http://127.0.0.1:3000",
    };

    // Act
    const result = parseEnv(env);

    // Assert
    expect(result.baseUrl).toBe("http://127.0.0.1:3000");
  });
});
