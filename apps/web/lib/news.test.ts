import { describe, expect, it } from "vitest";
import { parseNewsMarkdown } from "./news";

const article = [
  "---",
  'title: "Title: with colon"',
  'date: "2026-02-12"',
  'summary: "Summary"',
  "---",
  "",
  "Body line",
  "",
].join("\n");

describe("parseNewsMarkdown", () => {
  it("reads metadata from the front matter", () => {
    const result = parseNewsMarkdown(article);

    expect({ title: result.title, date: result.date, summary: result.summary }).toEqual({
      title: "Title: with colon",
      date: "2026-02-12",
      summary: "Summary",
    });
  });

  it("returns the body after the closing delimiter", () => {
    const result = parseNewsMarkdown(article);

    expect(result.content).toBe("\nBody line\n");
  });

  it("accepts CRLF line endings", () => {
    const result = parseNewsMarkdown(article.replaceAll("\n", "\r\n"));

    expect(result.title).toBe("Title: with colon");
  });

  it("throws when the front matter is missing", () => {
    const parse = () => parseNewsMarkdown("Body only\n");

    expect(parse).toThrow("front matter");
  });

  it("throws when a required field is missing", () => {
    const parse = () => parseNewsMarkdown('---\ntitle: "Title"\ndate: "2026-02-12"\n---\nBody\n');

    expect(parse).toThrow();
  });

  it("throws when the date is not a string", () => {
    const parse = () =>
      parseNewsMarkdown('---\ntitle: "Title"\ndate: 20260212\nsummary: "Summary"\n---\nBody\n');

    expect(parse).toThrow();
  });
});
