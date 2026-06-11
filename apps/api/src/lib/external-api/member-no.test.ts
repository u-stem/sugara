import { describe, expect, it } from "vitest";
import { buildMemberNoMap, invertMemberNoMap, resolveMemberRef } from "./member-no";

describe("invertMemberNoMap", () => {
  it("returns a map from memberNo to userId", () => {
    // Arrange: provide members in non-sorted order to confirm buildMemberNoMap sorts them
    const members = [
      { userId: "aaaaaaaa-0000-0000-0000-000000000002" },
      { userId: "aaaaaaaa-0000-0000-0000-000000000001" },
    ];
    const memberNoMap = buildMemberNoMap(members);

    // Act
    const inverted = invertMemberNoMap(memberNoMap);

    // Assert: sorted order means smaller UUID gets memberNo 1
    expect(inverted.get(1)).toBe("aaaaaaaa-0000-0000-0000-000000000001");
    expect(inverted.get(2)).toBe("aaaaaaaa-0000-0000-0000-000000000002");
  });

  it("round-trips with buildMemberNoMap: every memberNo resolves back to the original userId", () => {
    // Arrange
    const members = [
      { userId: "cccccccc-0000-0000-0000-000000000003" },
      { userId: "aaaaaaaa-0000-0000-0000-000000000001" },
      { userId: "bbbbbbbb-0000-0000-0000-000000000002" },
    ];
    const memberNoMap = buildMemberNoMap(members);

    // Act
    const inverted = invertMemberNoMap(memberNoMap);

    // Assert: every entry in the forward map resolves back via the inverse
    for (const [userId, memberNo] of memberNoMap) {
      expect(inverted.get(memberNo)).toBe(userId);
    }
  });

  it("returns an empty map when the input is empty", () => {
    // Arrange
    const memberNoMap = buildMemberNoMap([]);

    // Act
    const inverted = invertMemberNoMap(memberNoMap);

    // Assert
    expect(inverted.size).toBe(0);
  });
});

describe("resolveMemberRef", () => {
  it("returns memberNo and displayName for a known member", () => {
    // Arrange
    const userId = "aaaaaaaa-0000-0000-0000-000000000001";
    const memberNoMap = buildMemberNoMap([{ userId }]);
    const nameMap = new Map([[userId, "Alice"]]);

    // Act
    const ref = resolveMemberRef(memberNoMap, nameMap, userId);

    // Assert
    expect(ref).toEqual({ memberNo: 1, displayName: "Alice" });
  });

  it("falls back to displayName-only when the user is not in the member map", () => {
    // Arrange: user removed outside the normal flow — no memberNo, no name
    const memberNoMap = buildMemberNoMap([]);
    const nameMap = new Map<string, string>();

    // Act
    const ref = resolveMemberRef(memberNoMap, nameMap, "aaaaaaaa-0000-0000-0000-000000000009");

    // Assert
    expect(ref).toEqual({ displayName: "Unknown" });
  });
});
