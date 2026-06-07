import Markdown from "react-markdown";
import rehypeExternalLinks from "rehype-external-links";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

// Allowlist derived from rehype-sanitize's defaultSchema, hardened for
// user-authored article bodies:
//  - drop image/embed tags — articles intentionally don't support images
//    (see docs/plans/2026-06-06-articles-feature.md)
//  - restrict link protocols to web + mail; javascript:/data: fall away because
//    they aren't listed. rehype-raw is never added, so raw HTML stays inert.
const articleSchema = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => !["img", "picture", "source", "input"].includes(tag),
  ),
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
};

// Scoped typographic styling (no @tailwindcss/typography dependency); mirrors
// the inline-utility approach used by the news article page.
const PROSE = [
  "space-y-4 text-sm leading-relaxed text-foreground break-words",
  "[&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-bold",
  "[&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold",
  "[&_h4]:mt-4 [&_h4]:font-semibold",
  "[&_p]:leading-relaxed",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4",
  "[&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1",
  "[&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1",
  "[&_strong]:font-semibold",
  "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs",
  "[&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-3 [&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre>code]:text-xs",
  "[&_hr]:my-6 [&_hr]:border-border",
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
  "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
].join(" ");

type Props = {
  content: string;
  className?: string;
};

// Server Component safe — react-markdown renders without client interactivity.
export function MarkdownRenderer({ content, className }: Props) {
  return (
    <div className={className ? `${PROSE} ${className}` : PROSE}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[
          [rehypeSanitize, articleSchema],
          [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer", "nofollow"] }],
        ]}
      >
        {content}
      </Markdown>
    </div>
  );
}
