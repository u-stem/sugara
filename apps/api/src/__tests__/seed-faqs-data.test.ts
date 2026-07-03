import { describe, expect, it } from "vitest";
import { EN_FAQS, JA_FAQS, resolveCategory } from "../db/seed-faqs-data";

describe("resolveCategory", () => {
  it("classifies the weather-map FAQ (102) as tools", () => {
    expect(resolveCategory(102)).toBe("tools");
  });

  it("classifies the limits FAQ (103) as limits", () => {
    expect(resolveCategory(103)).toBe("limits");
  });

  it("classifies the external API FAQs (110-114) as api", () => {
    expect([110, 111, 112, 113, 114].map(resolveCategory)).toEqual([
      "api",
      "api",
      "api",
      "api",
      "api",
    ]);
  });
});

describe("FAQ seed data invariants", () => {
  it("has unique sortOrder values within JA_FAQS", () => {
    const orders = JA_FAQS.map((f) => f.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("has unique sortOrder values within EN_FAQS", () => {
    const orders = EN_FAQS.map((f) => f.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("has symmetric sortOrder sets between ja and en", () => {
    const ja = JA_FAQS.map((f) => f.sortOrder).sort((a, b) => a - b);
    const en = EN_FAQS.map((f) => f.sortOrder).sort((a, b) => a - b);
    expect(ja).toEqual(en);
  });

  // Every entry must land in a real category; "other" means a sortOrder fell
  // through every range in resolveCategory (a gap, not a deliberate bucket).
  it("classifies every FAQ into a non-other category", () => {
    const misclassified = JA_FAQS.filter((f) => resolveCategory(f.sortOrder) === "other").map(
      (f) => f.sortOrder,
    );
    expect(misclassified).toEqual([]);
  });
});
