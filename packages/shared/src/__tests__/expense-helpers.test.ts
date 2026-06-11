import { describe, expect, it } from "vitest";
import { getAmountInputStep } from "../currency";
import { getSplitDisplayCurrency, splitsTotalMatchesAmount } from "../schemas/expense";

describe("splitsTotalMatchesAmount", () => {
  it("returns true for equal split regardless of amounts", () => {
    // Arrange
    const data = {
      splitType: "equal" as const,
      splits: [{ amount: undefined }, { amount: undefined }],
      currency: "JPY" as const,
      amount: 1000,
    };

    // Act
    const result = splitsTotalMatchesAmount(data);

    // Assert
    expect(result).toBe(true);
  });

  it("returns true for custom split when minor-unit totals match (USD 6.25+6.25=12.50)", () => {
    // Arrange
    const data = {
      splitType: "custom" as const,
      splits: [{ amount: 6.25 }, { amount: 6.25 }],
      currency: "USD" as const,
      amount: 12.5,
    };

    // Act
    const result = splitsTotalMatchesAmount(data);

    // Assert
    expect(result).toBe(true);
  });

  it("returns false for custom split when minor-unit totals do not match", () => {
    // Arrange — 6.25 + 6.30 = 12.55 ≠ 12.50 (1255 ≠ 1250 minor units)
    const data = {
      splitType: "custom" as const,
      splits: [{ amount: 6.25 }, { amount: 6.3 }],
      currency: "USD" as const,
      amount: 12.5,
    };

    // Act
    const result = splitsTotalMatchesAmount(data);

    // Assert
    expect(result).toBe(false);
  });
});

describe("getSplitDisplayCurrency", () => {
  it("returns trip currency for equal split", () => {
    // Arrange / Act / Assert
    expect(getSplitDisplayCurrency("equal", "JPY", "USD")).toBe("JPY");
  });

  it("returns expense currency for custom split", () => {
    // Arrange / Act / Assert
    expect(getSplitDisplayCurrency("custom", "JPY", "USD")).toBe("USD");
  });

  it("returns expense currency for itemized split", () => {
    // Arrange / Act / Assert
    expect(getSplitDisplayCurrency("itemized", "JPY", "EUR")).toBe("EUR");
  });
});

describe("getAmountInputStep", () => {
  it("returns '1' for JPY (zero decimals)", () => {
    // Arrange / Act / Assert
    expect(getAmountInputStep("JPY")).toBe("1");
  });

  it("returns '0.01' for USD (two decimals)", () => {
    // Arrange / Act / Assert
    expect(getAmountInputStep("USD")).toBe("0.01");
  });

  it("returns '1' for KRW (zero decimals)", () => {
    // Arrange / Act / Assert
    expect(getAmountInputStep("KRW")).toBe("1");
  });
});
