import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/lib/test-utils";

const mockUseSearchParams = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    resetPassword: vi.fn().mockResolvedValue({ error: null }),
  },
}));

vi.mock("sonner");

describe("ResetPasswordPage", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("token がない場合はエラーメッセージを表示する", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams(""));
    const { default: ResetPasswordPage } = await import("./page");
    renderWithIntl(<ResetPasswordPage />);
    expect(screen.getByText(/無効なリンク/)).toBeDefined();
  });

  it("パスワードが一致しない場合はエラーを表示する", async () => {
    mockUseSearchParams.mockReturnValue(new URLSearchParams("token=valid-token"));
    const { default: ResetPasswordPage } = await import("./page");
    renderWithIntl(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText(/新しいパスワード/), {
      target: { value: "Password1!" },
    });
    fireEvent.change(screen.getByLabelText(/確認用/), {
      target: { value: "Different1!" },
    });
    fireEvent.click(screen.getByRole("button", { name: /設定/ }));
    expect(screen.getByText(/一致しません/)).toBeDefined();
  });
});
