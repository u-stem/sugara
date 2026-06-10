import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRevokeApiKeysByUserId } = vi.hoisted(() => ({
  mockRevokeApiKeysByUserId: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock("./external-api/api-key", () => ({
  revokeApiKeysByUserId: mockRevokeApiKeysByUserId,
}));

import { handleAfterChangePassword } from "./auth-hooks";

// A fake APIError-shaped object that satisfies isAPIError()'s name-based check
const fakeApiError: unknown = { name: "APIError", statusCode: 400, body: {} };

function makeCtx(
  path: string,
  opts: {
    returned?: unknown;
    userId?: string;
    session?: null;
  } = {},
) {
  const { returned = { token: "ok" }, userId = "user-1", session } = opts;
  return {
    path,
    context: {
      session: session === null ? null : { user: { id: userId } },
      returned,
    },
  };
}

describe("handleAfterChangePassword", () => {
  beforeEach(() => {
    mockRevokeApiKeysByUserId.mockClear();
  });

  it("revokes API keys when change-password succeeds", async () => {
    // Arrange
    const ctx = makeCtx("/change-password");

    // Act
    await handleAfterChangePassword(ctx);

    // Assert
    expect(mockRevokeApiKeysByUserId).toHaveBeenCalledWith("user-1");
  });

  it("does not revoke when returned value is an APIError", async () => {
    // Arrange
    const ctx = makeCtx("/change-password", { returned: fakeApiError });

    // Act
    await handleAfterChangePassword(ctx);

    // Assert
    expect(mockRevokeApiKeysByUserId).not.toHaveBeenCalled();
  });

  it("does not revoke when path is not change-password", async () => {
    // Arrange
    const ctx = makeCtx("/sign-in");

    // Act
    await handleAfterChangePassword(ctx);

    // Assert
    expect(mockRevokeApiKeysByUserId).not.toHaveBeenCalled();
  });

  it("does not revoke when session is null", async () => {
    // Arrange
    const ctx = makeCtx("/change-password", { session: null });

    // Act
    await handleAfterChangePassword(ctx);

    // Assert
    expect(mockRevokeApiKeysByUserId).not.toHaveBeenCalled();
  });
});
