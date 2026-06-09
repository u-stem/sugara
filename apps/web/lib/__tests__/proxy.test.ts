import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "../../proxy";

function makeRequest(pathname: string, opts: { viewMode?: string; ua?: string } = {}): NextRequest {
  const url = `http://localhost${pathname}`;
  const headers: Record<string, string> = {};
  if (opts.ua) headers["user-agent"] = opts.ua;

  const req = new NextRequest(url, { headers });
  if (opts.viewMode) {
    req.cookies.set("x-view-mode", opts.viewMode);
  }
  return req;
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

describe("proxy — SP redirect", () => {
  it("redirects /trips/[id] to /sp/trips/[id] in SP mode", async () => {
    const req = makeRequest("/trips/abc123", { viewMode: "sp" });
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/sp/trips/abc123");
  });

  it("does NOT redirect /trips/[id]/print to SP in SP mode", async () => {
    const req = makeRequest("/trips/abc123/print", { viewMode: "sp" });
    const res = await proxy(req);
    // Should pass through (no SP redirect), may redirect to /auth/login due to no session
    expect(res?.headers.get("location")).not.toContain("/sp/");
  });

  it("does NOT redirect /trips/[id]/export to SP in SP mode", async () => {
    const req = makeRequest("/trips/abc123/export", { viewMode: "sp" });
    const res = await proxy(req);
    expect(res?.headers.get("location")).not.toContain("/sp/");
  });

  it("redirects mobile UA with no cookie to SP for /trips", async () => {
    const req = makeRequest("/trips/abc123", { ua: MOBILE_UA });
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/sp/trips/abc123");
  });

  it("does NOT redirect mobile UA to SP for /trips/[id]/print", async () => {
    const req = makeRequest("/trips/abc123/print", { ua: MOBILE_UA });
    const res = await proxy(req);
    expect(res?.headers.get("location")).not.toContain("/sp/");
  });

  it("does NOT redirect mobile UA to SP for /trips/[id]/export", async () => {
    const req = makeRequest("/trips/abc123/export", { ua: MOBILE_UA });
    const res = await proxy(req);
    expect(res?.headers.get("location")).not.toContain("/sp/");
  });
});

describe("proxy — articles SP routing", () => {
  it("redirects /articles to /sp/articles in SP mode", async () => {
    const req = makeRequest("/articles", { viewMode: "sp" });
    const res = await proxy(req);
    expect(res?.headers.get("location")).toContain("/sp/articles");
  });

  it("does NOT bounce /sp/articles back to /articles (has SP counterpart)", async () => {
    const req = makeRequest("/sp/articles", { viewMode: "sp" });
    const res = await proxy(req);
    // Passes through (no redirect): SP counterpart exists and article pages
    // are anonymously viewable, so no SP→desktop bounce and no auth redirect.
    expect(res?.headers.get("location")).toBeNull();
  });

  it("redirects mobile UA with no cookie to SP for /articles", async () => {
    const req = makeRequest("/articles/abc123", { ua: MOBILE_UA });
    const res = await proxy(req);
    expect(res?.headers.get("location")).toContain("/sp/articles/abc123");
  });

  it("allows anonymous access to a desktop article detail (no login redirect)", async () => {
    const req = makeRequest("/articles/abc123", { viewMode: "desktop" });
    const res = await proxy(req);
    // optionalAuth on the API gates visibility; the page itself is public.
    expect(res?.headers.get("location")).toBeNull();
  });

  it("allows anonymous access to an SP article detail (no login redirect)", async () => {
    const req = makeRequest("/sp/articles/abc123", { viewMode: "sp" });
    const res = await proxy(req);
    expect(res?.headers.get("location")).toBeNull();
  });
});

describe("proxy — SP-only route fallback", () => {
  it("redirects /sp/notifications to /home in desktop mode", async () => {
    const req = makeRequest("/sp/notifications", { viewMode: "desktop" });
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/home");
    expect(res?.headers.get("location")).not.toContain("/notifications");
  });

  it("redirects /sp/trips/abc to /trips/abc in desktop mode (not SP-only)", async () => {
    const req = makeRequest("/sp/trips/abc", { viewMode: "desktop" });
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("location")).toContain("/trips/abc");
  });
});

describe("proxy — CSP nonce", () => {
  it("sets CSP header with nonce on non-auth pages", async () => {
    const req = makeRequest("/faq");
    const res = await proxy(req);
    const csp = res?.headers.get("Content-Security-Policy");
    expect(csp).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    // script-src uses nonce, not unsafe-inline
    expect(csp).toMatch(/script-src[^;]*'nonce-/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    // style-src uses unsafe-inline (required by vaul/react-remove-scroll)
    expect(csp).toMatch(/style-src[^;]*'unsafe-inline'/);
  });

  it("sets x-nonce header on non-auth pages", async () => {
    const req = makeRequest("/faq");
    const res = await proxy(req);
    const nonce = res?.headers.get("x-nonce");
    expect(nonce).toBeTruthy();
    expect(nonce?.length).toBeGreaterThan(0);
  });

  it("generates unique nonce per request", async () => {
    const res1 = await proxy(makeRequest("/faq"));
    const res2 = await proxy(makeRequest("/faq"));
    expect(res1?.headers.get("x-nonce")).not.toBe(res2?.headers.get("x-nonce"));
  });

  it("does not set CSP on redirect responses", async () => {
    const req = makeRequest("/trips/abc123", { viewMode: "sp" });
    const res = await proxy(req);
    expect(res?.status).toBe(307);
    expect(res?.headers.get("Content-Security-Policy")).toBeNull();
  });
});
