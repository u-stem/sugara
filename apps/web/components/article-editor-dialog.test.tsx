import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { ArticleEditorDialog } from "./article-editor-dialog";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useQueryClient: vi.fn(() => ({})),
  useIsRestoring: vi.fn(() => false),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  getApiErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/lib/markdown", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <p>{content}</p>,
}));

// ResponsiveDialog renders Dialog on desktop; stub useMobile to return false
vi.mock("@/lib/hooks/use-is-mobile", () => ({
  useMobile: () => false,
}));

const onOpenChange = vi.fn();
const onSaved = vi.fn();

describe("ArticleEditorDialog – format toolbar", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("bold button wraps selected text with **...**", () => {
    // Arrange
    renderWithIntl(
      <ArticleEditorDialog open={true} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const el = screen.getByPlaceholderText("本文を入力...");
    if (!(el instanceof HTMLTextAreaElement)) throw new Error("expected HTMLTextAreaElement");
    fireEvent.change(el, { target: { value: "Hello World" } });
    el.setSelectionRange(0, 5);

    // Act
    fireEvent.click(screen.getByRole("button", { name: "太字" }));

    // Assert
    expect(el.value).toBe("**Hello** World");
  });

  it("list button adds - prefix to each selected line", () => {
    // Arrange
    renderWithIntl(
      <ArticleEditorDialog open={true} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const el = screen.getByPlaceholderText("本文を入力...");
    if (!(el instanceof HTMLTextAreaElement)) throw new Error("expected HTMLTextAreaElement");
    fireEvent.change(el, { target: { value: "Foo\nBar" } });
    el.setSelectionRange(0, 7);

    // Act
    fireEvent.click(screen.getByRole("button", { name: "箇条書き" }));

    // Assert
    expect(el.value).toBe("- Foo\n- Bar");
  });

  it("link button inserts placeholder when no text is selected", () => {
    // Arrange
    renderWithIntl(
      <ArticleEditorDialog open={true} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const el = screen.getByPlaceholderText("本文を入力...");
    if (!(el instanceof HTMLTextAreaElement)) throw new Error("expected HTMLTextAreaElement");

    // Act: empty textarea, cursor at position 0
    fireEvent.click(screen.getByRole("button", { name: "リンク" }));

    // Assert
    expect(el.value).toBe("[リンクテキスト](https://)");
  });
});
