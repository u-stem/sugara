import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { linkifyText } from "../linkify";

function renderText(text: string) {
  // whitespace-pre-wrap mirrors how DayMemoEditor renders the memo.
  return render(<span className="whitespace-pre-wrap">{linkifyText(text)}</span>);
}

describe("linkifyText", () => {
  it("returns plain text unchanged when there is no URL", () => {
    const { container } = renderText("ただのメモです");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("ただのメモです");
  });

  it("turns an http(s) URL into a new-tab link", () => {
    const { container } = renderText("予約はこちら https://example.com/booking");
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("href")).toBe("https://example.com/booking");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    // Surrounding text is preserved.
    expect(container.textContent).toBe("予約はこちら https://example.com/booking");
  });

  it("links multiple URLs", () => {
    const { container } = renderText("https://a.example.com と https://b.example.com");
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("https://a.example.com");
    expect(links[1].getAttribute("href")).toBe("https://b.example.com");
  });

  it("stops a URL at the first non-URL (CJK) character", () => {
    const { container } = renderText("https://example.com/page見てね");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/page");
    expect(container.textContent).toBe("https://example.com/page見てね");
  });

  it("excludes trailing ASCII punctuation from the link", () => {
    const { container } = renderText("詳細は https://example.com/info.");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/info");
    expect(container.textContent).toBe("詳細は https://example.com/info.");
  });

  it("keeps balanced parentheses inside the URL", () => {
    const { container } = renderText("詳細 https://en.wikipedia.org/wiki/Tokyo_(city) を参照");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://en.wikipedia.org/wiki/Tokyo_(city)");
  });

  it("drops an unbalanced trailing paren from the sentence", () => {
    const { container } = renderText("(詳細は https://example.com/info)");
    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/info");
    expect(container.textContent).toBe("(詳細は https://example.com/info)");
  });

  it("does not link non-http schemes (XSS guard)", () => {
    const { container } = renderText("javascript:alert(1) と file:///etc/passwd");
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("javascript:alert(1) と file:///etc/passwd");
  });

  it("preserves newlines as text", () => {
    const { container } = renderText("1行目\nhttps://example.com\n3行目");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(container.textContent).toBe("1行目\nhttps://example.com\n3行目");
  });
});
