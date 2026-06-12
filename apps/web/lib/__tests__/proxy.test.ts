import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    // No SP redirect; the auth guard outcome (redirect or fail-open pass) is
    // covered by the auth guard suite below, so only assert the SP part here.
    expect(res?.headers.get("location") ?? "").not.toContain("/sp/");
  });

  it("does NOT redirect /trips/[id]/export to SP in SP mode", async () => {
    const req = makeRequest("/trips/abc123/export", { viewMode: "sp" });
    const res = await proxy(req);
    expect(res?.headers.get("location") ?? "").not.toContain("/sp/");
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
    expect(res?.headers.get("location") ?? "").not.toContain("/sp/");
  });

  it("does NOT redirect mobile UA to SP for /trips/[id]/export", async () => {
    const req = makeRequest("/trips/abc123/export", { ua: MOBILE_UA });
    const res = await proxy(req);
    expect(res?.headers.get("location") ?? "").not.toContain("/sp/");
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

describe("proxy — auth guard session check", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubGetSession(handler: () => Promise<Response>) {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        if (String(input).includes("/api/auth/get-session")) return handler();
        return Promise.reject(new Error(`unexpected fetch: ${input}`));
      }),
    );
  }

  it("redirects a protected path to login when get-session returns 200 with null", async () => {
    stubGetSession(() => Promise.resolve(new Response("null", { status: 200 })));
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("location")).toContain("/auth/login");
  });

  it("passes a protected path through when get-session returns a session", async () => {
    stubGetSession(() =>
      Promise.resolve(new Response(JSON.stringify({ session: { id: "s1" } }), { status: 200 })),
    );
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("fails open on a protected path when get-session is rate-limited (429)", async () => {
    // A 429 (or any non-OK) proves nothing about the visitor's session; bouncing
    // to /auth/login here logged out legitimately authenticated users (#162).
    stubGetSession(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
      ),
    );
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("fails open on a protected path when get-session returns a 5xx", async () => {
    stubGetSession(() => Promise.resolve(new Response("oops", { status: 503 })));
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("fails open on a protected path when the get-session fetch throws", async () => {
    stubGetSession(() => Promise.reject(new TypeError("fetch failed")));
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("fails open on a protected path when get-session returns 200 with a non-JSON body", async () => {
    // res.json() throws → caught by the same fail-open catch as network errors.
    stubGetSession(() => Promise.resolve(new Response("<!DOCTYPE html>", { status: 200 })));
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("location")).toBeNull();
  });

  it("still sets CSP headers on a fail-open pass-through", async () => {
    stubGetSession(() => Promise.resolve(new Response("oops", { status: 503 })));
    const res = await proxy(makeRequest("/home"));

    expect(res?.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("redirects a guest-only path to home when authenticated", async () => {
    stubGetSession(() =>
      Promise.resolve(new Response(JSON.stringify({ session: { id: "s1" } }), { status: 200 })),
    );
    const res = await proxy(makeRequest("/auth/login"));

    expect(res?.headers.get("location")).toContain("/home");
  });

  it("renders a guest-only path when get-session is rate-limited (429)", async () => {
    stubGetSession(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
      ),
    );
    const res = await proxy(makeRequest("/auth/login"));

    expect(res?.headers.get("location")).toBeNull();
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
