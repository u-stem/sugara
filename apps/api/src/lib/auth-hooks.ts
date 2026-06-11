import { isAPIError } from "better-auth/api";
import { revokeApiKeysByUserId } from "./external-api/api-key";

// Minimal shape of the middleware context this hook reads.
// The full Better Auth middleware context is a superset of this type; we only
// reference the fields we actually use so the plain function is testable without
// constructing the full context.
type ChangePasswordCtx = {
  path: string;
  context: {
    session: { user: { id: string } } | null;
    returned?: unknown;
  };
};

// POST /change-password (the authenticated settings-page flow) does not go
// through emailAndPassword.onPasswordReset, which only fires on the
// reset-email flow. We hook it separately here so that a user who rotates
// their password from the settings screen also has their long-lived API keys
// revoked.
//
// Motivation: if credentials are suspected compromised and the user rotates
// their password, leaving active API keys alive defeats the purpose of the
// rotation. Long-lived tokens must be invalidated together with the session
// credentials they were derived from.
//
// Fail-closed: we intentionally do NOT try-catch here. If revocation throws,
// the hook propagates the error and the response becomes 500. Silently
// swallowing the error would let long-lived tokens survive a rotation that
// was triggered specifically by a suspected compromise.
export async function handleAfterChangePassword(ctx: ChangePasswordCtx): Promise<void> {
  if (ctx.path !== "/change-password") return;
  // Do not revoke if the endpoint itself returned an error (e.g. wrong current
  // password). In that case no password change occurred, so there is nothing
  // to revoke.
  if (isAPIError(ctx.context.returned)) return;
  const userId = ctx.context.session?.user.id;
  if (userId) await revokeApiKeysByUserId(userId);
}
