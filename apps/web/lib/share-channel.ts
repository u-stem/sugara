/**
 * Realtime channel that notifies shared-link viewers of edits.
 *
 * The key is derived by the API from the share token (SHA-256 hex), so members
 * can broadcast to it without ever holding a working share link.
 */
export function sharedTripChannelName(shareChannelKey: string): string {
  return `trip-shared:${shareChannelKey}`;
}
