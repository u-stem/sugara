import type { ArticleListItem } from "@sugara/shared";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
