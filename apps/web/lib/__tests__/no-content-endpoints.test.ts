import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  matchesNoContentEndpoint,
  NO_CONTENT_ENDPOINTS,
  normalizeApiPath,
} from "../no-content-endpoints";

const WEB_ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "components", "lib"];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .filter((p) => /\.(ts|tsx)$/.test(p))
    .filter((p) => !/\.test\.(ts|tsx)$/.test(p))
    .filter((p) => !p.includes(`${path.sep}__tests__${path.sep}`));
}

// Extract the substring inside the parentheses of a call starting at `openIdx`
// (the index of the `(`), honoring string/template literals and nested brackets
// so parens inside strings or nested calls do not end the scan early.
function extractCallArgs(src: string, openIdx: number): string | null {
  let depth = 0;
  // A template literal is treated as an opaque quoted span: `${...}` inside the
  // call paths in this codebase never nests further backticks, so collapsing the
  // whole literal to a string is enough to keep paren counting accurate.
  let quote: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    const prev = src[i - 1];
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

// Pull the leading string/template literal (the path argument) out of a call's
// argument list. Returns null when the first argument is not a literal — those
// dynamic call sites cannot be analyzed statically and are skipped.
function extractPathLiteral(args: string): string | null {
  const trimmed = args.trimStart();
  const first = trimmed[0];
  if (first !== '"' && first !== "'" && first !== "`") return null;
  for (let i = 1; i < trimmed.length; i++) {
    if (trimmed[i] === first && trimmed[i - 1] !== "\\") {
      return trimmed.slice(1, i);
    }
  }
  return null;
}

function extractMethod(args: string): string {
  const m = args.match(/method\s*:\s*["'`]([A-Za-z]+)["'`]/);
  return m ? m[1] : "GET";
}

type CallSite = { file: string; method: string; rawPath: string; normalized: string };

// Match `api(` and `api<T>(` calls but not `apiVoid(`, member access (`.api(`),
// or identifiers that merely end in `api`.
const API_CALL_RE = /(?<![\w$.])api\s*(?:<[^(]*>)?\s*\(/g;

function scanApiCalls(src: string, file: string): CallSite[] {
  const calls: CallSite[] = [];
  for (const match of src.matchAll(API_CALL_RE)) {
    const openIdx = src.indexOf("(", match.index + "api".length);
    if (openIdx === -1) continue;
    const args = extractCallArgs(src, openIdx);
    if (args === null) continue;
    const rawPath = extractPathLiteral(args);
    if (rawPath === null) continue;
    calls.push({
      file,
      method: extractMethod(args),
      rawPath,
      normalized: normalizeApiPath(rawPath),
    });
  }
  return calls;
}

function collectAllApiCalls(): CallSite[] {
  const calls: CallSite[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listSourceFiles(path.join(WEB_ROOT, dir))) {
      calls.push(...scanApiCalls(readFileSync(file, "utf8"), path.relative(WEB_ROOT, file)));
    }
  }
  return calls;
}

// Build the literal text "${name}" without writing the placeholder inline,
// which would otherwise trip biome's noTemplateCurlyInString on these
// intentional `${...}`-in-a-string fixtures.
const ph = (name: string) => `$${"{"}${name}}`;

describe("no-content endpoint guard", () => {
  it("the scanner is wired correctly (finds api() calls and parses them)", () => {
    const calls = collectAllApiCalls();
    // A silent zero would make the guard below vacuously pass.
    expect(calls.length).toBeGreaterThan(10);

    const sample = scanApiCalls(
      `api(\`/api/quick-polls/${ph("id")}\`, { method: "DELETE" });`,
      "synthetic.ts",
    );
    expect(sample).toEqual([
      {
        file: "synthetic.ts",
        method: "DELETE",
        rawPath: `/api/quick-polls/${ph("id")}`,
        normalized: "/api/quick-polls/:param",
      },
    ]);

    // apiVoid() must not be picked up as an api() call.
    expect(scanApiCalls('apiVoid("/api/account", { method: "DELETE" })', "s.ts")).toEqual([]);
  });

  it("normalizes template and :id path segments to :param", () => {
    expect(normalizeApiPath(`/api/trips/${ph("tripId")}/expenses/${ph("expenseId")}`)).toBe(
      "/api/trips/:param/expenses/:param",
    );
    expect(normalizeApiPath("/api/quick-polls/:id")).toBe("/api/quick-polls/:param");
    expect(normalizeApiPath(`/api/expenses?tripId=${ph("id")}`)).toBe("/api/expenses");
  });

  it("flags a known 204 DELETE but not the same path under GET", () => {
    expect(matchesNoContentEndpoint("DELETE", "/api/quick-polls/:param")).toBe(true);
    expect(matchesNoContentEndpoint("GET", "/api/quick-polls/:param")).toBe(false);
    expect(matchesNoContentEndpoint("DELETE", "/api/quick-polls")).toBe(false);
  });

  it("no api<T>() call targets a 204 No Content endpoint (use apiVoid instead)", () => {
    const violations = collectAllApiCalls().filter((c) =>
      matchesNoContentEndpoint(c.method, c.normalized),
    );
    const detail = violations
      .map((v) => `  ${v.file}: api(${v.method} ${v.rawPath}) — should be apiVoid()`)
      .join("\n");
    expect(violations, `api() used against 204 endpoints:\n${detail}`).toEqual([]);
  });

  it("every registered 204 endpoint is exercised by an apiVoid() call site", () => {
    // Guards against the list drifting stale: if an endpoint stops being called
    // via apiVoid (renamed/removed), the entry should be updated or dropped.
    const apiVoidPaths = new Set<string>();
    for (const dir of SCAN_DIRS) {
      for (const file of listSourceFiles(path.join(WEB_ROOT, dir))) {
        const src = readFileSync(file, "utf8");
        for (const match of src.matchAll(/apiVoid\s*\(/g)) {
          const openIdx = src.indexOf("(", match.index + "apiVoid".length);
          const args = extractCallArgs(src, openIdx);
          if (!args) continue;
          const rawPath = extractPathLiteral(args);
          if (rawPath === null) continue;
          apiVoidPaths.add(`${extractMethod(args)} ${normalizeApiPath(rawPath)}`);
        }
      }
    }
    const uncovered = NO_CONTENT_ENDPOINTS.filter(
      (e) =>
        ![...apiVoidPaths].some(
          (p) => p.startsWith(`${e.method} `) && e.pattern.test(p.slice(e.method.length + 1)),
        ),
    );
    expect(uncovered.map((e) => `${e.method} ${e.pattern}`)).toEqual([]);
  });
});
