import { describe, expect, it } from "vitest";
import {
  CURRENCIES,
  convertToBase,
  currencyCodeSchema,
  formatCurrency,
  formatWholeUnits,
  fromMinorUnits,
  toMinorUnits,
} from "./currency";

describe("toMinorUnits", () => {
  it("converts USD amount to cents", () => {
    expect(toMinorUnits(12.5, "USD")).toBe(1250);
  });

  it("converts JPY amount unchanged (no decimals)", () => {
    expect(toMinorUnits(1000, "JPY")).toBe(1000);
  });

  it("converts KRW amount unchanged (no decimals)", () => {
    expect(toMinorUnits(5000, "KRW")).toBe(5000);
  });

  // Documents the existing Math.round semantics for edge inputs so a future
  // refactor cannot silently change the rounding direction.
  it("rounds a fractional JPY amount to the nearest whole unit", () => {
    expect(toMinorUnits(100.5, "JPY")).toBe(101);
  });

  it("rounds a negative half value toward positive infinity (Math.round semantics)", () => {
    expect(toMinorUnits(-12.5, "JPY")).toBe(-12);
  });

  it("converts zero to zero", () => {
    expect(toMinorUnits(0, "USD")).toBe(0);
  });

  it("avoids binary float truncation for amounts like 1.15", () => {
    // 1.15 * 100 === 114.99999... — Math.round (not trunc) keeps this at 115.
    expect(toMinorUnits(1.15, "USD")).toBe(115);
  });
});

describe("fromMinorUnits", () => {
  it("converts cents to USD amount", () => {
    expect(fromMinorUnits(1250, "USD")).toBe(12.5);
  });

  it("converts JPY minor units unchanged (no decimals)", () => {
    expect(fromMinorUnits(1000, "JPY")).toBe(1000);
  });
});

describe("convertToBase", () => {
  it("converts USD minor units to JPY minor units", () => {
    // 10050 cents * 148.5 / 100 = 14924.25 → 14924
    expect(convertToBase(10050, "USD", "JPY", 148.5)).toBe(14924);
  });

  it("converts JPY minor units to USD minor units", () => {
    // 1000 yen * 0.00673 * 100 / 1 = 673
    expect(convertToBase(1000, "JPY", "USD", 0.00673)).toBe(673);
  });

  it("returns input unchanged when currencies are the same", () => {
    expect(convertToBase(5000, "JPY", "JPY", 1)).toBe(5000);
  });

  it("rounds down when fractional part is below .5", () => {
    // 1050 * 148.5 / 100 = 1559.25 → 1559
    expect(convertToBase(1050, "USD", "JPY", 148.5)).toBe(1559);
  });

  it("rounds up when fractional part is .5 or above", () => {
    // need a case that rounds up: 101 cents * 148.0 / 100 = 149.48 → 149
    // try: 1 cent * 1.005 rate to JPY (decimals 0): 1 * 1.005 * 1 / 100 = 0.01005 → 0
    // better: use THB (2 decimals) → USD (2 decimals): 1 * 1.505 * 100 / 100 = 1.505 → 2
    expect(convertToBase(1, "THB", "USD", 1.505)).toBe(2);
  });
});

describe("formatCurrency", () => {
  it("formats JPY in Japanese locale", () => {
    expect(formatCurrency(14924, "JPY", "ja")).toContain("14,924");
  });

  it("formats USD in English locale", () => {
    expect(formatCurrency(1250, "USD", "en")).toContain("12.50");
  });
});

describe("formatWholeUnits", () => {
  it("formats a JPY whole-unit fare without scaling", () => {
    // 580 stays 580, not divided by any minor-unit factor
    expect(formatWholeUnits(580, "JPY", "ja")).toBe("￥580");
  });

  it("formats a non-JPY whole-unit fare without minor-unit scaling", () => {
    // 580 must render as $580, NOT $5.80 (the bug formatCurrency caused)
    expect(formatWholeUnits(580, "USD", "en")).toBe("$580");
  });

  it("drops fractional digits for currencies with decimals", () => {
    expect(formatWholeUnits(580, "USD", "en")).not.toContain(".");
  });
});

describe("CURRENCIES", () => {
  it("has all 12 entries", () => {
    expect(Object.keys(CURRENCIES)).toHaveLength(12);
  });
});

describe("currencyCodeSchema", () => {
  it("accepts valid currency codes", () => {
    expect(currencyCodeSchema.safeParse("JPY").success).toBe(true);
    expect(currencyCodeSchema.safeParse("USD").success).toBe(true);
  });

  it("rejects invalid currency codes", () => {
    expect(currencyCodeSchema.safeParse("XXX").success).toBe(false);
  });
});
