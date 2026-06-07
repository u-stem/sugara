import type { ArticleListItem } from "@sugara/shared";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { ArticleCard } from "./article-card";

const base: ArticleListItem = {
  id: "a1",
  ownerId: "u1",
  title: "Kyoto cafes",
  tags: ["kyoto", "coffee"],
  visibility: "public",
  sortOrder: 0,
  likeCount: 3,
  likedByMe: false,
  createdAt: "2026-06-06T00:00:00.000Z",
  updatedAt: "2026-06-06T00:00:00.000Z",
};

describe("ArticleCard", () => {
  afterEach(cleanup);

  it("renders title, tags and like count, linking to the detail page", () => {
    renderWithIntl(<ArticleCard {...base} />);
    expect(screen.getByText("Kyoto cafes")).toBeDefined();
    expect(screen.getByText("kyoto")).toBeDefined();
    expect(screen.getByText("coffee")).toBeDefined();
    expect(screen.getByText("3")).toBeDefined();
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/articles/a1");
  });

  it("respects the hrefPrefix for SP routes", () => {
    renderWithIntl(<ArticleCard {...base} hrefPrefix="/sp/articles" />);
    expect(screen.getByRole("link").getAttribute("href")).toBe("/sp/articles/a1");
  });

  it("renders a button instead of a link when selectable", () => {
    renderWithIntl(<ArticleCard {...base} selectable />);
    expect(screen.queryByRole("link")).toBeNull();
    const btn = screen.getByRole("button");
    expect(btn).toBeDefined();
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("calls onSelect with the article id when the selectable button is clicked", () => {
    const onSelect = vi.fn();
    renderWithIntl(<ArticleCard {...base} selectable onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onSelect).toHaveBeenCalledWith("a1");
  });

  it("reflects selected state via aria-pressed", () => {
    renderWithIntl(<ArticleCard {...base} selectable selected />);
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
