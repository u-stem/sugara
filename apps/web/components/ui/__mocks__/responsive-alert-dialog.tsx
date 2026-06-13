// Manual mock for the Radix-backed responsive-alert-dialog, shared across
// component tests. A test opts in with a bare
// `vi.mock("@/components/ui/responsive-alert-dialog")` (no factory). All parts
// render their children inline; the destructive action becomes a plain button
// so tests can click "confirm" without driving the real Radix portal/overlay.
import type { ReactNode } from "react";

const Passthrough = ({ children }: { children: ReactNode }) => <>{children}</>;

export const ResponsiveAlertDialog = Passthrough;
export const ResponsiveAlertDialogTrigger = Passthrough;
export const ResponsiveAlertDialogContent = Passthrough;
export const ResponsiveAlertDialogHeader = Passthrough;
export const ResponsiveAlertDialogTitle = Passthrough;
export const ResponsiveAlertDialogDescription = Passthrough;
export const ResponsiveAlertDialogFooter = Passthrough;
export const ResponsiveAlertDialogCancel = Passthrough;

// Confirm-style actions render as plain buttons so a test can click them
// without the real Radix portal; onClick/disabled pass straight through.
const ActionButton = ({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button type="button" onClick={onClick} disabled={disabled}>
    {children}
  </button>
);

export const ResponsiveAlertDialogAction = ActionButton;
export const ResponsiveAlertDialogDestructiveAction = ActionButton;
