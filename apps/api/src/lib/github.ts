import { logger } from "./logger";

// owner/repo, GitHub's allowed character set for both segments.
export const REPO_FORMAT = /^[\w.-]+\/[\w.-]+$/;

const GITHUB_API = "https://api.github.com";

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };
}

type CreateIssueArgs = {
  token: string;
  repo: string;
  title: string;
  body: string;
  labels: string[];
};

// Creates a GitHub issue. Returns its html_url, or null on any failure (the
// caller decides how to surface that to the webhook sender).
export async function createGithubIssue({
  token,
  repo,
  title,
  body,
  labels,
}: CreateIssueArgs): Promise<string | null> {
  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, labels }),
  });

  if (!res.ok) {
    const errorBody = await res.json().catch((err) => {
      logger.debug({ err }, "Failed to parse GitHub error response");
      return {};
    });
    logger.error({ status: res.status, errorBody }, "GitHub issue creation failed");
    return null;
  }

  const data = await res.json().catch((err) => {
    logger.error({ err }, "Failed to parse GitHub success response");
    return null;
  });
  return typeof data?.html_url === "string" ? data.html_url : null;
}

// Searches the repo for an existing issue carrying `marker` in its body. Used to
// dedupe repeated Sentry alerts for the same issue. Returns the issue's html_url
// if found, null otherwise (including on search failure — fail open, do not block
// issue creation just because search hiccuped).
export async function findGithubIssueByMarker({
  token,
  repo,
  marker,
}: {
  token: string;
  repo: string;
  marker: string;
}): Promise<string | null> {
  // Quote the marker so GitHub search treats it as a phrase, not loose tokens.
  const query = `repo:${repo} in:body "${marker}"`;
  const res = await fetch(`${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}&per_page=1`, {
    headers: authHeaders(token),
  });

  if (!res.ok) {
    logger.warn({ status: res.status }, "GitHub issue search failed, proceeding without dedupe");
    return null;
  }

  const data = await res.json().catch((err) => {
    logger.warn({ err }, "Failed to parse GitHub search response");
    return null;
  });
  const first = Array.isArray(data?.items) ? data.items[0] : undefined;
  return typeof first?.html_url === "string" ? first.html_url : null;
}
