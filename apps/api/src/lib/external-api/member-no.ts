// Deterministic userId → 1-indexed memberNo mapping for v1 external API.
//
// trip_members has no joinedAt column, so we sort by userId ascending (lexicographic
// UUID order). The result is stable across requests for the same membership set:
// the same set of user UUIDs always produces the same memberNo assignments.
// This is the single source of truth referenced by members[], payer, and splits
// in all v1 responses; passing the same members array everywhere guarantees
// consistency within one response.
export function buildMemberNoMap(members: ReadonlyArray<{ userId: string }>): Map<string, number> {
  const sorted = [...members].sort((a, b) => a.userId.localeCompare(b.userId));
  const map = new Map<string, number>();
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    if (m !== undefined) {
      map.set(m.userId, i + 1);
    }
  }
  return map;
}

// Looks up a userId by its 1-indexed memberNo.
// Returns undefined when the memberNo is not present in the map
// (e.g. the caller supplied an out-of-range or invalid number).
export function resolveMemberNoToUserId(
  memberNoMap: Map<string, number>,
  memberNo: number,
): string | undefined {
  for (const [userId, no] of memberNoMap) {
    if (no === memberNo) return userId;
  }
  return undefined;
}
