import type { AccountColor, ConnectedAccount, Conversation } from "@trailin/shared";
import { ChevronDown } from "lucide-react";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Chip } from "@/components/ui/chip";
import { api } from "@/lib/api";
import { useServerEvents } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";
import { cn } from "@/lib/utils";

// The conversations endpoint has no by-id lookup, only the paginated list
// (routes/chat.ts caps it at 200) — this reads the same page the history
// rail's first load would, wide enough that the open conversation is
// virtually always in range by recency.
const CONVERSATIONS_LOOKUP_LIMIT = 200;

type Focus = Pick<Conversation, "focusAccountId" | "focusThreadId" | "focusThreadSubject">;

const NO_FOCUS: Focus = { focusAccountId: null, focusThreadId: null, focusThreadSubject: null };

/**
 * Chat header control for the conversation's account focus: a colored dot +
 * account name once set, extended with `· <subject>` while a thread is also
 * focal; a muted "All accounts" idle chip otherwise. Clicking opens an
 * anchored popover to pick a connected account or clear focus.
 *
 * Picks apply optimistically and PATCH the server; the server is also the
 * source of truth when the agent moves focus mid-turn, so this subscribes to
 * the same "conversations" server event the history rail reconciles from.
 *
 * Before a conversation exists (a brand-new, unsent chat) there is no row to
 * PATCH, so a pick is held in the caller's `pendingFocusAccountId` instead; the
 * first message carries it to the server (ChatPanel → useChatRuns → /api/chat),
 * which opens the new conversation already focused on that mailbox.
 */
export function FocusChip({
  conversationId,
  pendingFocusAccountId,
  onPendingFocusChange,
}: {
  conversationId: string | undefined;
  /** The pre-conversation pick; used for display and selection while `conversationId` is undefined. */
  pendingFocusAccountId?: string | null;
  onPendingFocusChange?: (accountId: string | null) => void;
}) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = React.useState<ConnectedAccount[]>([]);
  const [colors, setColors] = React.useState<AccountColor[]>([]);
  const [focus, setFocus] = React.useState<Focus>(NO_FOCUS);
  const { open, setOpen, pos, triggerRef, popoverRef } = useAnchoredPopover<HTMLSpanElement>();

  // Cosmetic (account list + colors for the popover rows) — a failed load
  // just leaves the picker showing fewer accounts, never surfaced as an error.
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([api.pipedreamAccounts(), api.accountColors()])
      .then(([accountList, { colors: colorList }]) => {
        if (cancelled) return;
        setAccounts(accountList);
        setColors(colorList);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loadFocus = React.useCallback(() => {
    if (!conversationId) {
      setFocus(NO_FOCUS);
      return;
    }
    api
      .conversations({ limit: CONVERSATIONS_LOOKUP_LIMIT })
      .then(({ items }) => {
        const row = items.find((c) => c.id === conversationId);
        setFocus(
          row
            ? {
                focusAccountId: row.focusAccountId ?? null,
                focusThreadId: row.focusThreadId ?? null,
                focusThreadSubject: row.focusThreadSubject ?? null,
              }
            : NO_FOCUS,
        );
      })
      .catch(() => {});
  }, [conversationId]);

  React.useEffect(loadFocus, [loadFocus]);
  // A manual pick from another tab, or the agent moving focus mid-turn,
  // both land here through the same topic the history rail refetches on.
  useServerEvents(["conversations"], loadFocus);

  const pick = async (accountId: string | null) => {
    setOpen(false);
    // No conversation yet: hold the pick locally; the first message carries it.
    if (!conversationId) {
      onPendingFocusChange?.(accountId);
      return;
    }
    if (accountId === focus.focusAccountId) return;
    const previous = focus;
    setFocus(
      accountId === null
        ? NO_FOCUS
        : { focusAccountId: accountId, focusThreadId: null, focusThreadSubject: null },
    );
    try {
      await api.setConversationFocus(conversationId, accountId);
    } catch (err) {
      setFocus(previous);
      toast.error(err);
    }
  };

  // With a conversation, focus is the row's own; before one exists it's the
  // caller's pending pick. A thread part only ever exists on a real conversation.
  const focusAccountId = conversationId ? focus.focusAccountId : (pendingFocusAccountId ?? null);
  const focusThreadSubject = conversationId ? focus.focusThreadSubject : null;
  const focusedAccount = accounts.find((a) => a.id === focusAccountId);
  const focusedColor = colors.find((c) => c.accountId === focusAccountId)?.hex;
  const hasFocus = Boolean(focusAccountId);
  const label = hasFocus
    ? [focusedAccount?.name ?? focusAccountId, focusThreadSubject].filter(Boolean).join(" · ")
    : t("chat.focus.allAccounts");

  return (
    <span ref={triggerRef} className="inline-flex min-w-0">
      <Chip
        active={hasFocus}
        aria-expanded={open}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={cn(
          "min-w-0 max-w-56 disabled:pointer-events-none disabled:opacity-50",
          // A focus is a quiet status marker, not a filter toggle — override the
          // shared Chip's ink fill with a neutral grey so the colored account dot
          // and label carry the state instead of a heavy high-contrast pill.
          hasFocus && "bg-secondary text-foreground hover:bg-secondary",
        )}
      >
        {hasFocus && <AccountDot color={focusedColor} />}
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown
          aria-hidden
          className={cn("h-3 w-3 shrink-0 opacity-60 transition-transform", open && "rotate-180")}
        />
      </Chip>

      {open &&
        createPortal(
          // Portaled content still bubbles React synthetic events up the
          // component tree (not the DOM tree) — this wrapper only guards that
          // propagation, so it isn't itself an interactive element.
          // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not a control itself
          <div
            ref={popoverRef}
            role="presentation"
            className="surface-pop animate-in-up fixed z-[130] flex max-h-72 w-64 flex-col gap-0.5 overflow-y-auto p-1"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            <FocusOption
              selected={!hasFocus}
              label={t("chat.focus.allAccounts")}
              onClick={() => void pick(null)}
            />
            {accounts.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-muted-foreground">
                {t("chat.focus.noAccounts")}
              </p>
            ) : (
              accounts.map((account) => (
                <FocusOption
                  key={account.id}
                  selected={account.id === focusAccountId}
                  color={colors.find((c) => c.accountId === account.id)?.hex}
                  label={account.name}
                  onClick={() => void pick(account.id)}
                />
              ))
            )}
          </div>,
          document.body,
        )}
    </span>
  );
}

function FocusOption({
  selected,
  color,
  label,
  onClick,
}: {
  selected: boolean;
  /** Omitted for the "all accounts" row — it isn't a real account color. */
  color?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
        selected ? "bg-accent/10 text-accent" : "text-foreground hover:bg-secondary",
      )}
    >
      {color ? (
        <AccountDot color={color} />
      ) : (
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
      )}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
