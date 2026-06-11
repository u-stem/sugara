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

// MemberRef represents a reference to a trip member in v1 API responses.
// When the member is present in the trip's membership list, both memberNo and
// displayName are included. When that invariant is broken (e.g. a member was
// removed outside the normal flow), only displayName is returned as a
// defensive fallback. See design doc §4.3 defensive fallback note.
export type MemberRef = { memberNo: number; displayName: string } | { displayName: string };

// Resolves a userId to its MemberRef for v1 API response serialization.
// Single source of truth shared by read (index.ts) and write (expenses-write.ts) routes.
export function resolveMemberRef(
  memberNoMap: Map<string, number>,
  nameMap: Map<string, string>,
  userId: string,
): MemberRef {
  const memberNo = memberNoMap.get(userId);
  const displayName = nameMap.get(userId) ?? "Unknown";
  if (memberNo !== undefined) {
    return { memberNo, displayName };
  }
  // Defensive fallback: invariant broken — include displayName only
  return { displayName };
}

// Builds a memberNo → userId reverse lookup map from the given memberNoMap.
// The resulting map supports O(1) userId resolution by memberNo, replacing
// the O(n) linear scan over the forward map.
export function invertMemberNoMap(memberNoMap: Map<string, number>): Map<number, string> {
  const inverted = new Map<number, string>();
  for (const [userId, memberNo] of memberNoMap) {
    inverted.set(memberNo, userId);
  }
  return inverted;
}
