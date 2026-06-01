import { describe, expect, it, vi } from "vitest";
import {
  calculateDirectTransfers,
  calculateEqualSplit,
  calculateSettlement,
} from "../lib/settlement";

const alice = { id: "alice-id", name: "Alice" };
const bob = { id: "bob-id", name: "Bob" };
const charlie = { id: "charlie-id", name: "Charlie" };

describe("calculateEqualSplit", () => {
  it("splits evenly when divisible", () => {
    expect(calculateEqualSplit(1000, 2)).toEqual([500, 500]);
  });

  it("adds remainder to first member", () => {
    const result = calculateEqualSplit(1000, 3);
    expect(result).toEqual([334, 333, 333]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it("handles single member", () => {
    expect(calculateEqualSplit(500, 1)).toEqual([500]);
  });

  it("handles remainder of 2 with 3 members", () => {
    const result = calculateEqualSplit(1001, 3);
    expect(result).toEqual([334, 334, 333]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1001);
  });
});

describe("calculateSettlement", () => {
  it("returns empty transfers when no expenses", () => {
    const result = calculateSettlement([], [alice, bob]);
    expect(result.totalAmount).toBe(0);
    expect(result.balances).toEqual([
      { userId: alice.id, name: alice.name, net: 0 },
      { userId: bob.id, name: bob.name, net: 0 },
    ]);
    expect(result.transfers).toEqual([]);
  });

  it("calculates transfer for single expense between 2 members", () => {
    const result = calculateSettlement(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result.totalAmount).toBe(1000);
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toEqual({
      from: bob,
      to: alice,
      amount: 500,
    });
  });

  it("optimizes transfers for 3 members with multiple expenses", () => {
    const result = calculateSettlement(
      [
        {
          paidByUserId: alice.id,
          amount: 3000,
          splits: [
            { userId: alice.id, amount: 1000 },
            { userId: bob.id, amount: 1000 },
            { userId: charlie.id, amount: 1000 },
          ],
        },
        {
          paidByUserId: bob.id,
          amount: 1500,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
            { userId: charlie.id, amount: 500 },
          ],
        },
      ],
      [alice, bob, charlie],
    );

    expect(result.totalAmount).toBe(4500);
    // Alice paid 3000, owes 1500 -> net = +1500
    // Bob paid 1500, owes 1500 -> net = 0
    // Charlie paid 0, owes 1500 -> net = -1500
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toEqual({
      from: charlie,
      to: alice,
      amount: 1500,
    });
  });

  it("handles custom splits", () => {
    const result = calculateSettlement(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 300 },
            { userId: bob.id, amount: 700 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0]).toEqual({
      from: bob,
      to: alice,
      amount: 700,
    });
  });

  it("returns no transfers when everyone is even", () => {
    const result = calculateSettlement(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
        {
          paidByUserId: bob.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result.transfers).toEqual([]);
  });

  it("warns when expense references a user not in member list", async () => {
    const { logger } = await import("../lib/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const unknownUserId = "unknown-id";
    const result = calculateSettlement(
      [
        {
          paidByUserId: unknownUserId,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: unknownUserId }),
      expect.any(String),
    );
    // unknown user's net balance is ignored in transfers
    expect(result.transfers).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("handles rounding with equal split of 1000 among 3", () => {
    // 1000 / 3 = 334 + 333 + 333
    const result = calculateSettlement(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 334 },
            { userId: bob.id, amount: 333 },
            { userId: charlie.id, amount: 333 },
          ],
        },
      ],
      [alice, bob, charlie],
    );

    expect(result.totalAmount).toBe(1000);
    // Alice paid 1000, owes 334 -> net = +666
    // Bob paid 0, owes 333 -> net = -333
    // Charlie paid 0, owes 333 -> net = -333
    const totalTransfer = result.transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(totalTransfer).toBe(666);
  });
});

describe("calculateDirectTransfers", () => {
  it("returns empty when no expenses", () => {
    expect(calculateDirectTransfers([], [alice, bob])).toEqual([]);
  });

  it("makes each member pay the payer directly for a single expense", () => {
    const result = calculateDirectTransfers(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    // Bob owes Alice his 500 share; Alice's own share is self-funded
    expect(result).toEqual([{ from: bob, to: alice, amount: 500 }]);
  });

  it("nets out reciprocal debts between the same pair", () => {
    // Alice paid 1000 (each owes 500), Bob paid 600 (each owes 300)
    // Bob->Alice 500, Alice->Bob 300 => net Bob->Alice 200
    const result = calculateDirectTransfers(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
        {
          paidByUserId: bob.id,
          amount: 600,
          splits: [
            { userId: alice.id, amount: 300 },
            { userId: bob.id, amount: 300 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result).toEqual([{ from: bob, to: alice, amount: 200 }]);
  });

  // Reproduces the reported case: charlie pays a large expense, then owes even
  // more on another, so minimal settlement never shows "X -> charlie", but
  // direct mode does (after netting).
  describe("reported case where minimal settlement hides a direct creditor", () => {
    const expenses = [
      {
        // "test": charlie paid 60000, equal split 3 ways
        paidByUserId: charlie.id,
        amount: 60000,
        splits: [
          { userId: alice.id, amount: 20000 },
          { userId: bob.id, amount: 20000 },
          { userId: charlie.id, amount: 20000 },
        ],
      },
      {
        // "wasabi soda": alice paid 1200, split between alice & bob only
        paidByUserId: alice.id,
        amount: 1200,
        splits: [
          { userId: alice.id, amount: 600 },
          { userId: bob.id, amount: 600 },
        ],
      },
      {
        // "ryokan": alice paid 56430, equal split 3 ways
        paidByUserId: alice.id,
        amount: 56430,
        splits: [
          { userId: alice.id, amount: 18810 },
          { userId: bob.id, amount: 18810 },
          { userId: charlie.id, amount: 18810 },
        ],
      },
    ];
    const members = [alice, bob, charlie];

    it("nets each pair into a descending list of direct transfers", () => {
      // alice<->charlie: alice owes charlie 20000 (test), charlie owes alice 18810 (ryokan)
      //   => net alice -> charlie 1190
      // bob -> charlie 20000 (test)
      // bob -> alice 600 (wasabi) + 18810 (ryokan) = 19410
      expect(calculateDirectTransfers(expenses, members)).toEqual([
        { from: bob, to: charlie, amount: 20000 },
        { from: bob, to: alice, amount: 19410 },
        { from: alice, to: charlie, amount: 1190 },
      ]);
    });

    it("preserves the same per-member net as the minimal settlement", () => {
      const direct = calculateDirectTransfers(expenses, members);
      const minimal = calculateSettlement(expenses, members);
      const directNet = new Map<string, number>();
      for (const t of direct) {
        directNet.set(t.from.id, (directNet.get(t.from.id) ?? 0) - t.amount);
        directNet.set(t.to.id, (directNet.get(t.to.id) ?? 0) + t.amount);
      }
      const minimalNet = Object.fromEntries(minimal.balances.map((b) => [b.userId, b.net]));
      const directNetObj = Object.fromEntries(members.map((m) => [m.id, directNet.get(m.id) ?? 0]));
      expect(directNetObj).toEqual(minimalNet);
    });
  });

  it("omits a fully offset pair", () => {
    const result = calculateDirectTransfers(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
        {
          paidByUserId: bob.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result).toEqual([]);
  });

  it("warns with the payer id when the payer is not in the member list", async () => {
    const { logger } = await import("../lib/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    calculateDirectTransfers(
      [
        {
          paidByUserId: "unknown-id",
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "unknown-id" }),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it("produces no transfers when the payer is not in the member list", () => {
    const result = calculateDirectTransfers(
      [
        {
          paidByUserId: "unknown-id",
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: bob.id, amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result).toEqual([]);
  });

  it("warns with the split user id when a split user is not in the member list", async () => {
    const { logger } = await import("../lib/logger");
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    calculateDirectTransfers(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: "unknown-id", amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "unknown-id" }),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });

  it("skips a split user not in the member list without emitting a transfer", () => {
    const result = calculateDirectTransfers(
      [
        {
          paidByUserId: alice.id,
          amount: 1000,
          splits: [
            { userId: alice.id, amount: 500 },
            { userId: "unknown-id", amount: 500 },
          ],
        },
      ],
      [alice, bob],
    );

    expect(result).toEqual([]);
  });
});
