import * as React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Components = {
  p: ({ children }) => <p className="leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1: ({ children }) => <h1 className="font-semibold tracking-tight">{children}</h1>,
  h2: ({ children }) => <h2 className="font-semibold tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="font-semibold tracking-tight">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted-foreground/25 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-muted-foreground/20" />,
  code: ({ children, ...props }) => (
    <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]" {...props}>
      {children}
    </code>
  ),
  // Block code is <pre><code>; style the wrapper and neutralize the nested
  // <code> so it doesn't double up on background/padding.
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[0.85em] leading-relaxed [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-muted-foreground/20 px-2 py-1 font-medium">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-muted-foreground/10 px-2 py-1 align-top">{children}</td>
  ),
};

/** Renders LLM-produced markdown (chat replies, automation run reports) as styled text. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("[&>*:not(:last-child)]:mb-2", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
