import * as React from "react";

/**
 * Wraps every case-insensitive occurrence of `query` in `text` with the shared
 * matched-text mark (`.match-mark`, the pale ::selection-style accent tint).
 * A single character matches so often that marking it up turns text into
 * confetti, so highlighting only starts at `minLength`.
 */
export function Highlight({
  text,
  query,
  minLength = 2,
}: {
  text: string;
  query: string;
  minLength?: number;
}) {
  const trimmed = query.trim();
  if (trimmed.length < minLength) return <>{text}</>;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "ig"));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // Fragments hold no state and their order is fixed by position in the
          // split string — a fresh `text`/`query` always replaces the whole list.
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless text fragments, order is inherent to the split
          <mark key={i} className="match-mark">
            {part}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: stateless text fragments, order is inherent to the split
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}
