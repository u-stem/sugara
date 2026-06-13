import { ARTICLE_CONTENT_MAX_LENGTH } from "@sugara/shared";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";
import { ArticleEditorDialog } from "./article-editor-dialog";

function getTextarea(): HTMLTextAreaElement {
  const el = screen.getByPlaceholderText("本文を入力...");
  if (!(el instanceof HTMLTextAreaElement)) throw new Error("expected HTMLTextAreaElement");
  return el;
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: [], isLoading: false, error: null })),
  useQueryClient: vi.fn(() => ({})),
  useIsRestoring: vi.fn(() => false),
}));

vi.mock("@/lib/api", () => ({
  api: vi.fn(),
  getApiErrorMessage: vi.fn((_e: unknown, fallback: string) => fallback),
}));

vi.mock("sonner");

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
  let rafCallbacks: FrameRequestCallback[] = [];

  // jsdom doesn't run rAF. Queue callbacks and flush them after the click, once
  // React has committed the new textarea value, so setSelectionRange is accurate.
  function flushRaf() {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb(0);
  }

  beforeEach(() => {
    rafCallbacks = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function setup(value = "", selection?: [number, number]): HTMLTextAreaElement {
    renderWithIntl(
      <ArticleEditorDialog open={true} onOpenChange={onOpenChange} onSaved={onSaved} />,
    );
    const el = getTextarea();
    if (value) fireEvent.change(el, { target: { value } });
    if (selection) el.setSelectionRange(selection[0], selection[1]);
    return el;
  }

  it("bold button wraps selected text with **...**", () => {
    const el = setup("Hello World", [0, 5]);
    fireEvent.click(screen.getByRole("button", { name: "太字" }));
    expect(el.value).toBe("**Hello** World");
  });

  it("bold keeps the selection around the wrapped text", () => {
    const el = setup("Hello World", [0, 5]);
    fireEvent.click(screen.getByRole("button", { name: "太字" }));
    flushRaf();
    expect([el.selectionStart, el.selectionEnd]).toEqual([2, 7]);
  });

  it("bold toggles off when the selection is already wrapped", () => {
    // "**Hello** World" with the inner "Hello" selected (positions 2–7).
    const el = setup("**Hello** World", [2, 7]);
    fireEvent.click(screen.getByRole("button", { name: "太字" }));
    expect(el.value).toBe("Hello World");
  });

  it("italic wraps selected text with _..._", () => {
    const el = setup("Hello World", [0, 5]);
    fireEvent.click(screen.getByRole("button", { name: "斜体" }));
    expect(el.value).toBe("_Hello_ World");
  });

  it("heading adds ## prefix to the line", () => {
    const el = setup("Title", [0, 5]);
    fireEvent.click(screen.getByRole("button", { name: "見出し" }));
    expect(el.value).toBe("## Title");
  });

  it("quote adds > prefix to each selected line", () => {
    const el = setup("Foo\nBar", [0, 7]);
    fireEvent.click(screen.getByRole("button", { name: "引用" }));
    expect(el.value).toBe("> Foo\n> Bar");
  });

  it("list button adds - prefix to each selected line", () => {
    const el = setup("Foo\nBar", [0, 7]);
    fireEvent.click(screen.getByRole("button", { name: "箇条書き" }));
    expect(el.value).toBe("- Foo\n- Bar");
  });

  it("list toggles off when every line already has the prefix", () => {
    const el = setup("- Foo\n- Bar", [0, 11]);
    fireEvent.click(screen.getByRole("button", { name: "箇条書き" }));
    expect(el.value).toBe("Foo\nBar");
  });

  it("does not prefix the empty trailing line on a full selection", () => {
    // Regression: a selection ending in "\n" must not add a dangling "- ".
    const el = setup("Foo\n", [0, 4]);
    fireEvent.click(screen.getByRole("button", { name: "箇条書き" }));
    expect(el.value).toBe("- Foo\n");
  });

  it("link button wraps the selection and selects the URL placeholder", () => {
    const el = setup("docs", [0, 4]);
    fireEvent.click(screen.getByRole("button", { name: "リンク" }));
    flushRaf();
    expect(el.value).toBe("[docs](https://)");
    // The "https://" placeholder is selected so the user can type the real URL.
    expect(el.value.slice(el.selectionStart, el.selectionEnd)).toBe("https://");
  });

  it("link button inserts placeholder when no text is selected", () => {
    const el = setup();
    fireEvent.click(screen.getByRole("button", { name: "リンク" }));
    expect(el.value).toBe("[リンクテキスト](https://)");
  });

  it("does not apply formatting that would exceed the content limit", () => {
    const value = "a".repeat(ARTICLE_CONTENT_MAX_LENGTH);
    const el = setup(value, [0, value.length]);
    fireEvent.click(screen.getByRole("button", { name: "太字" }));
    // Wrapping would add 4 chars and overflow, so the content is left unchanged.
    expect(el.value).toBe(value);
  });
});
