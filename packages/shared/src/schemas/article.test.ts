import { describe, expect, it } from "vitest";
import { createArticleSchema, setArticleTripsSchema, updateArticleSchema } from "./article";

describe("createArticleSchema", () => {
  it("accepts a minimal valid article with defaults", () => {
    const r = createArticleSchema.parse({ title: "旅のコツ" });
    expect(r.title).toBe("旅のコツ");
    expect(r.content).toBe("");
    expect(r.tags).toEqual([]);
    expect(r.visibility).toBe("private");
  });

  it("rejects an empty title", () => {
    expect(createArticleSchema.safeParse({ title: "" }).success).toBe(false);
  });

  it("rejects a title over the limit", () => {
    expect(createArticleSchema.safeParse({ title: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects content over the limit", () => {
    expect(createArticleSchema.safeParse({ title: "t", content: "a".repeat(20001) }).success).toBe(
      false,
    );
  });

  it("rejects more than the max tags", () => {
    const tags = ["1", "2", "3", "4", "5", "6"];
    expect(createArticleSchema.safeParse({ title: "t", tags }).success).toBe(false);
  });

  it("rejects duplicate tags", () => {
    expect(createArticleSchema.safeParse({ title: "t", tags: ["a", "a"] }).success).toBe(false);
  });

  it("rejects an empty tag", () => {
    expect(createArticleSchema.safeParse({ title: "t", tags: [""] }).success).toBe(false);
  });

  it("accepts a known visibility", () => {
    expect(createArticleSchema.parse({ title: "t", visibility: "public" }).visibility).toBe(
      "public",
    );
  });

  it("rejects an unknown visibility", () => {
    expect(createArticleSchema.safeParse({ title: "t", visibility: "secret" }).success).toBe(false);
  });
});

describe("updateArticleSchema", () => {
  it("allows partial updates", () => {
    const r = updateArticleSchema.parse({ visibility: "friends_only" });
    expect(r.visibility).toBe("friends_only");
    expect(r.title).toBeUndefined();
  });
});

describe("setArticleTripsSchema", () => {
  const guid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  it("defaults to an empty list", () => {
    expect(setArticleTripsSchema.parse({}).tripIds).toEqual([]);
  });

  it("rejects more than the max linked trips", () => {
    const tripIds = Array.from({ length: 11 }, (_, i) => guid(i));
    expect(setArticleTripsSchema.safeParse({ tripIds }).success).toBe(false);
  });

  it("rejects duplicate trip ids", () => {
    expect(setArticleTripsSchema.safeParse({ tripIds: [guid(1), guid(1)] }).success).toBe(false);
  });

  it("rejects non-guid ids", () => {
    expect(setArticleTripsSchema.safeParse({ tripIds: ["not-a-guid"] }).success).toBe(false);
  });
});
