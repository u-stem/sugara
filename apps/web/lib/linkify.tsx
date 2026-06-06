import type { ReactNode } from "react";
import { isSafeUrl } from "@/lib/format";

// Match http(s) URLs only. The character class excludes whitespace and CJK so a
// URL stops at the first non-URL character (e.g. "https://example.com見て" links
// just the URL, not the trailing Japanese text).
const URL_REGEX = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

// Split trailing punctuation that belongs to the prose, not the URL. A closing
// paren is only trimmed when unbalanced, so URLs like ".../Tokyo_(city)" keep
// their paren while "(see https://example.com)" drops the sentence's paren.
function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw;
  let trailing = "";
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (".,;:!?".includes(last)) {
      trailing = last + trailing;
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = (url.match(/\(/g) ?? []).length;
      const closes = (url.match(/\)/g) ?? []).length;
      if (closes > opens) {
        trailing = last + trailing;
        url = url.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return { url, trailing };
}

/**
 * Convert plain text into React nodes, turning safe http(s) URLs into links.
 *
 * XSS-safe: only URLs passing isSafeUrl become anchors, and the result is a
 * React node array (never dangerouslySetInnerHTML). Links call stopPropagation
 * so they can be embedded inside a clickable container (e.g. an editable memo)
 * without triggering the container's own click handler.
 */
export function linkifyText(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = URL_REGEX.exec(text);
  while (match !== null) {
    const start = match.index;
    const matchEnd = start + match[0].length;
    const { url, trailing } = splitTrailingPunctuation(match[0]);

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }
    if (url && isSafeUrl(url)) {
      nodes.push(
        <a
          key={`l${key}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-blue-600 underline underline-offset-2 hover:no-underline dark:text-blue-400"
        >
          {url}
        </a>,
      );
    } else if (url) {
      nodes.push(url);
    }
    if (trailing) {
      nodes.push(trailing);
    }

    lastIndex = matchEnd;
    key += 1;
    match = URL_REGEX.exec(text);
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}
