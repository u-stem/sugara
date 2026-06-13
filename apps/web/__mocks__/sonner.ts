// Manual mock for sonner, shared across component tests. A test opts in with
// a bare `vi.mock("sonner")` (no factory); the toast spies live here so the
// shape stays defined in one place instead of being copy-pasted per file.
// vi.clearAllMocks() in each test's afterEach resets the call history.
import { vi } from "vitest";

export const toast = Object.assign(vi.fn(), {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  message: vi.fn(),
  dismiss: vi.fn(),
  promise: vi.fn(),
});

export const Toaster = () => null;
