import { Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isMailboxUrl } from "@/lib/mailboxLinks";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed text-foreground/90">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  a: ({ children, href, ...props }) => {
    const { t } = useTranslation();

    if (isMailboxUrl(href)) {
      return (
        <a
          {...props}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-0.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-2/80 active:bg-surface-2/60 align-baseline mx-0.5"
          title={t("markdown.openInMailbox")}
        >
          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{children}</span>
        </a>
      );
    }

    if (href?.startsWith("mailto:")) {
      // Copies the address instead of navigating, so this is a button styled as
      // a link, not a real anchor — it never leads anywhere.
      const email = href.replace("mailto:", "");
      return (
        <button
          type="button"
          onClick={() => {
            if (!navigator.clipboard) {
              toast.error(t("markdown.copyFailed", { email }));
              return;
            }
            navigator.clipboard
              .writeText(email)
              .then(() => toast.success(t("markdown.copiedToClipboard", { email })))
              .catch(() => toast.error(t("markdown.copyFailed", { email })));
          }}
          className="font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent"
          title={t("markdown.copyEmailAddress")}
        >
          {children}
        </button>
      );
    }

    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:decoration-accent"
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => (
    <ul className="my-2 ml-5 list-disc space-y-1.5 marker:text-accent/80">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1.5 marker:text-muted-foreground/70">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed text-foreground/90 pl-1">{children}</li>,
  h1: ({ children }) => (
    <h1 className="mt-6 mb-3 text-xl font-semibold tracking-tight text-foreground">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 mb-2 text-lg font-semibold tracking-tight text-foreground">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 mb-2 text-base font-semibold tracking-tight text-foreground">{children}</h3>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-4 text-[0.95em] text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  code: ({ children, ...props }) => (
    <code
      className="rounded bg-surface-2/60 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground/80"
      {...props}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-surface-2/40 p-4 font-mono text-[0.85em] leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-border px-3 py-2 font-medium text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
};

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** Text inside these keeps its exact spacing; word-wrapping would restyle it. */
const STREAM_SKIP = new Set(["code", "pre"]);

/**
 * Wraps each word of a streaming message in a `.stream-word` span so newly
 * arrived text fades in. Earlier words keep their positional identity across
 * deltas, so a word animates once, when it first appears — only markdown that
 * restructures around the tail (e.g. emphasis closing) replays its words.
 */
function rehypeStreamWords() {
  return (tree: unknown) => wrapWords(tree as HastNode);
}

function wrapWords(node: HastNode): void {
  if (!node.children || (node.tagName && STREAM_SKIP.has(node.tagName))) return;
  node.children = node.children.flatMap((child): HastNode[] => {
    if (child.type !== "text" || !child.value) {
      wrapWords(child);
      return [child];
    }
    return child.value
      .split(/(\s+)/)
      .filter(Boolean)
      .map((part) =>
        /^\s/.test(part)
          ? { type: "text", value: part }
          : {
              type: "element",
              tagName: "span",
              properties: { className: ["stream-word"] },
              children: [{ type: "text", value: part }],
            },
      );
  });
}

const STREAM_PLUGINS = [rehypeStreamWords];

/** Renders LLM-produced markdown (chat replies, automation run reports) as styled text.
 *  `stream` marks text still being generated: new words fade in as they arrive. */
export function Markdown({
  content,
  className,
  stream,
}: {
  content: string;
  className?: string;
  stream?: boolean;
}) {
  return (
    <div className={cn("[&>*:not(:last-child)]:mb-2", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={stream ? STREAM_PLUGINS : undefined}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
