import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./markdown";

describe("MarkdownRenderer", () => {
  it("renders basic Markdown elements", () => {
    const { container } = render(
      <MarkdownRenderer content={"# Title\n\nSome **bold** text.\n\n- a\n- b"} />,
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders GFM tables (remark-gfm)", () => {
    const md = ["| a | b |", "| - | - |", "| 1 | 2 |"].join("\n");
    const { container } = render(<MarkdownRenderer content={md} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("does not render images", () => {
    const { container } = render(
      <MarkdownRenderer content={"![alt](https://example.com/x.png)"} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps raw HTML inert (no rehype-raw)", () => {
    const { container } = render(
      <MarkdownRenderer content={'<script>alert(1)</script><div onclick="alert(2)">x</div>'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("div[onclick]")).toBeNull();
  });

  it("strips dangerous link protocols", () => {
    const { container } = render(<MarkdownRenderer content={"[click](javascript:alert(1))"} />);
    const anchor = container.querySelector("a");
    // javascript: is not in the protocol allowlist, so href is dropped/neutralized.
    expect(anchor?.getAttribute("href") ?? "").not.toContain("javascript:");
  });

  it("marks external links with target and rel", () => {
    const { container } = render(<MarkdownRenderer content={"[site](https://example.com)"} />);
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
    expect(anchor?.getAttribute("rel")).toContain("noreferrer");
  });
});
