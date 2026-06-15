import { describe, expect, it } from "vitest";
import { escapeLike } from "./like-escape";

describe("escapeLike", () => {
  it("passes through strings with no metacharacters", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("escapes percent sign so it becomes a literal character in ILIKE", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes underscore so it becomes a literal character in ILIKE", () => {
    expect(escapeLike("a_b")).toBe("a\\_b");
  });

  it("escapes backslash so the escape character itself is treated literally", () => {
    expect(escapeLike("a\\b")).toBe("a\\\\b");
  });

  it("escapes all metacharacters in a mixed string", () => {
    expect(escapeLike("a%_\\b")).toBe("a\\%\\_\\\\b");
  });

  it("returns empty string unchanged", () => {
    expect(escapeLike("")).toBe("");
  });

  it("does not alter alphanumeric and common punctuation", () => {
    expect(escapeLike("Tokyo 東京!")).toBe("Tokyo 東京!");
  });
});
