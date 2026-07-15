/*
 * Interactive demos for the shared primitives the /showcase gallery exercises —
 * each one holds its own state so the page stays a live test bench, not a
 * screenshot. Part of the DEV showcase; safe to delete with the folder.
 */

import { Brain, ChevronDown, ChevronUp, FileText, FolderOpen, Sunrise } from "lucide-react";
import * as React from "react";
import { RunStatusBadge } from "@/components/RunStatusBadge";
import { AccountDot } from "@/components/ui/account-dot";
import { DisclosureToggle } from "@/components/ui/disclosure-toggle";
import { LoadingRow, Notice, RetryableError } from "@/components/ui/feedback";
import { IconChip } from "@/components/ui/icon-chip";
import { Kbd } from "@/components/ui/kbd";
import { LinkButton } from "@/components/ui/link-button";
import { ListRow } from "@/components/ui/list-row";
import { SearchField } from "@/components/ui/search-field";
import { ShowMoreButton } from "@/components/ui/show-more-button";
import { usePagedVisible } from "@/lib/usePagedVisible";
import { cn, MOD_LABEL, toggleRowProps } from "@/lib/utils";

/** The tiny shared shapes: icon chips, account dots, and keyboard hints. */
export function SmallMarksDemo() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <IconChip>
          <Sunrise />
        </IconChip>
        <IconChip tone="tint-neutral">
          <FolderOpen />
        </IconChip>
        <IconChip size="sm">
          <Brain />
        </IconChip>
        <IconChip size="sm" tone="tint-neutral">
          <FileText />
        </IconChip>
        <span className="text-xs text-muted-foreground">
          IconChip — accent/neutral · md 28px / sm 24px, icons sized by the chip
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <AccountDot color="#4f46e5" />
        <AccountDot color="#0d9488" />
        <AccountDot />
        <AccountDot color="#4f46e5" className="h-2.5 w-2.5" />
        <span className="text-xs text-muted-foreground">
          AccountDot — the bare one is the unassigned-grey fallback; resize via className
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Kbd className="px-1.5">{MOD_LABEL}K</Kbd>
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <Kbd className="px-1.5">tab</Kbd>
        <Kbd className="px-1.5">esc</Kbd>
        <span className="text-xs text-muted-foreground">Kbd — keyboard hints</span>
      </div>
    </>
  );
}

const PAGED_SENDERS = [
  "Morning Digest",
  "Product Weekly",
  "Design Notes",
  "Changelog",
  "The Long Read",
  "Metrics Monday",
  "Paper Trail",
  "Release Radar",
  "Quiet Fridays",
  "Field Notes",
  "Ship It",
  "Sunday Edition",
];

/**
 * SearchField + usePagedVisible + ShowMoreButton wired together the way the
 * lanes use them: the cap grows by steps and resets whenever the filter
 * changes, so "show more" never sits past the end of a narrower list.
 */
export function PagedListDemo() {
  const [query, setQuery] = React.useState("");
  const { visible, showMore } = usePagedVisible(4, 4, query);
  const q = query.trim().toLowerCase();
  const filtered = PAGED_SENDERS.filter((label) => label.toLowerCase().includes(q));
  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  return (
    <div className="flex max-w-md flex-col gap-2">
      <SearchField value={query} onChange={setQuery} placeholder="Filter senders…" />
      {shown.map((label) => (
        <ListRow key={label}>
          <span className="text-sm">{label}</span>
          <span className="text-2xs text-muted-foreground">weekly</span>
        </ListRow>
      ))}
      {remaining > 0 && <ShowMoreButton count={remaining} onClick={showMore} />}
      {filtered.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No matches — clear the filter and the cap starts over at 4.
        </p>
      )}
    </div>
  );
}

/** RetryableError that actually recovers: the third attempt "succeeds". */
export function RetryableErrorDemo() {
  const [attempts, setAttempts] = React.useState(0);

  if (attempts >= 2) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Notice tone="success">Loaded on the third attempt — the banner clears on success.</Notice>
        <LinkButton onClick={() => setAttempts(0)}>Break it again</LinkButton>
      </div>
    );
  }
  return (
    <RetryableError onRetry={() => setAttempts((n) => n + 1)}>
      Could not load the contact list{attempts > 0 ? ` (attempt ${attempts + 1})` : ""}.
    </RetryableError>
  );
}

/** LoadingRow at its default size and the compact className override. */
export function LoadingRowsDemo() {
  return (
    <div className="flex flex-col gap-1">
      <LoadingRow label="Loading your drafts…" />
      <LoadingRow className="py-1 text-xs" label="Compact — sized down via className" />
    </div>
  );
}

/** Every Notice tone, plus a dismissible one that can be brought back. */
export function NoticeDemo() {
  const [dismissed, setDismissed] = React.useState(false);
  return (
    <div className="flex flex-col gap-2">
      {dismissed ? (
        <LinkButton onClick={() => setDismissed(false)}>Bring the dismissed notice back</LinkButton>
      ) : (
        <Notice
          tone="accent"
          onDismiss={() => setDismissed(true)}
          className="flex justify-between gap-3"
        >
          Accent notice with the optional dismiss affordance.
        </Notice>
      )}
      <Notice tone="neutral">Neutral — a quiet setup hint.</Notice>
      <Notice tone="success">Success — the flow finished.</Notice>
      <Notice tone="warning">Warning — something needs attention.</Notice>
      <Notice tone="danger">Danger — the request failed.</Notice>
    </div>
  );
}

/** The quiet open/close disclosure — chevron up/down, no fill. */
export function DisclosureDemo() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col gap-2">
      <DisclosureToggle open={open} onToggle={() => setOpen((o) => !o)}>
        {open ? "Hide delivery details" : "Show delivery details"}
      </DisclosureToggle>
      {open && (
        <p className="text-xs text-muted-foreground">
          Sent via smtp-relay · TLS 1.3 · queued 09:41, delivered 09:42.
        </p>
      )}
    </div>
  );
}

/**
 * toggleRowProps in action: the whole header row expands/collapses — focus it
 * and press Enter or Space. Used where the header wraps real buttons and so
 * can't be a native <button> itself.
 */
export function ToggleRowDemo() {
  const [expanded, setExpanded] = React.useState(false);
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div
        className={cn("flex cursor-pointer items-center justify-between gap-3")}
        {...toggleRowProps(expanded, () => setExpanded((e) => !e))}
      >
        <p className="flex items-center gap-2 text-sm font-medium">
          Weekly digest ran
          {expanded ? (
            <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
        </p>
        <RunStatusBadge status="success" />
      </div>
      {expanded && (
        <p className="mt-2 text-xs text-muted-foreground">
          The row carries role, tabIndex, aria-expanded and Enter/Space handling from toggleRowProps
          — keyboard-toggle it to test.
        </p>
      )}
    </div>
  );
}
