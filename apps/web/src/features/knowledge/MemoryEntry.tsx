import type { ConnectedAccount, MemoryEntry } from "@trailin/shared";
import { MEMORY_MAX_LENGTH } from "@trailin/shared";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { HoverActions } from "@/components/ui/hover-actions";
import { InlineEditButton } from "@/components/ui/inline-edit-button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { useAutoGrow } from "@/lib/useAutoGrow";
import { cn } from "@/lib/utils";

/**
 * Everything that renders one memory entry: the display row, the shared
 * add/edit card, and the scope dot/chip vocabulary both share with the strip.
 */

/** The three mutually exclusive scope axes a memory can carry. */
export type ScopeKind = "general" | "account" | "contact";

/** The one dot for memory scopes — an account's assigned color (`AccountDot`
 *  owns the unassigned-grey fallback), the accent for a contact, a theme-aware
 *  ink for General — shared by filter chips, group headers, and rows so the
 *  same scope always wears the same mark. */
export function ScopeDot({
  kind,
  color,
  className,
}: {
  kind: ScopeKind;
  /** The account dot's fill; unused for the other kinds. */
  color?: string;
  className?: string;
}) {
  return (
    <AccountDot
      color={color}
      tone={kind === "general" ? "ink" : kind === "contact" ? "accent" : undefined}
      className={className}
    />
  );
}

/** One filter pill in the memory strip's account/scope row — same shape as the
 *  weekday toggle in Automations, the app's one existing pill-filter pattern.
 *  Doubles as the single-select scope chip inside MemoryEditor. */
export function MemoryFilterChip({
  active,
  kind,
  color,
  onClick,
  title,
  children,
}: {
  active: boolean;
  /** Scope dot ahead of the label; omitted for dotless chips ("All"). */
  kind?: ScopeKind;
  /** Account dot fill for `kind="account"`. */
  color?: string;
  onClick: () => void;
  /** Full account/contact address, shown on hover when the label is the short local part. */
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <Chip active={active} onClick={onClick} title={title}>
      {kind && <ScopeDot kind={kind} color={color} />}
      <span className="max-w-36 truncate">{children}</span>
    </Chip>
  );
}

/** The counter only appears once a memory is nearing the length cap, not from the first keystroke. */
const MEMORY_COUNTER_THRESHOLD = MEMORY_MAX_LENGTH - 60;

/**
 * The one shared editor for adding and editing a memory: an auto-growing
 * textarea plus a footer of scope chips (left) and Cancel/Save (right). Used
 * both by the strip's composer (expanded, empty content) and by a row in edit
 * mode (prefilled).
 */
export function MemoryEditor({
  initialContent,
  initialAccountId,
  initialContactId,
  emailAccounts,
  accountColor,
  busy,
  onSave,
  onCancel,
  ariaLabel,
  placeholder,
}: {
  /** "" for a fresh composer. */
  initialContent: string;
  initialAccountId: string | null;
  initialContactId: string | null;
  emailAccounts: ConnectedAccount[];
  accountColor: (accountId: string) => string | undefined;
  /** True while a save is in flight — disables every control. */
  busy: boolean;
  onSave: (content: string, accountId: string | null, contactId: string | null) => void;
  onCancel: () => void;
  ariaLabel: string;
  placeholder: string;
}) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(initialContent);
  // "" is a live contact scope with the address still to be typed (the
  // composer presets it when the Contacts filter is active) — only null
  // means "not contact-scoped".
  const [scopeKind, setScopeKind] = React.useState<ScopeKind>(
    initialContactId !== null ? "contact" : initialAccountId ? "account" : "general",
  );
  const [accountId, setAccountId] = React.useState(initialAccountId ?? "");
  const [contactAddress, setContactAddress] = React.useState(initialContactId ?? "");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const contactInputRef = React.useRef<HTMLInputElement>(null);

  useAutoGrow(textareaRef, value);

  // autoFocus alone doesn't guarantee the caret lands at the end of prefilled
  // content in every browser — place it explicitly, once, on mount.
  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  }, []);

  // Picking Contact reveals a free-text address field — send focus straight
  // there instead of leaving the click stranded on the (now hidden) chip.
  React.useEffect(() => {
    if (scopeKind === "contact") contactInputRef.current?.focus();
  }, [scopeKind]);

  const trimmed = value.trim();
  const trimmedContact = contactAddress.trim().toLowerCase();
  const resolvedAccountId = scopeKind === "account" ? accountId || null : null;
  const resolvedContactId = scopeKind === "contact" ? trimmedContact || null : null;
  const unchanged =
    trimmed === initialContent.trim() &&
    resolvedAccountId === (initialAccountId ?? null) &&
    resolvedContactId === (initialContactId ?? null);
  const canSave =
    trimmed.length > 0 &&
    !unchanged &&
    !busy &&
    (scopeKind !== "contact" || trimmedContact.length > 0);

  const save = () => {
    if (!canSave) return;
    onSave(trimmed, resolvedAccountId, resolvedContactId);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        disabled={busy}
        maxLength={MEMORY_MAX_LENGTH}
        aria-label={ariaLabel}
        placeholder={placeholder}
        rows={2}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />
      <div className="flex flex-wrap items-center gap-2">
        <fieldset
          aria-label={t("knowledge.sections.memory.scopeLabel")}
          aria-disabled={busy}
          className={cn(
            "m-0 flex min-w-0 flex-1 flex-wrap items-center gap-1.5 border-0 p-0",
            busy && "pointer-events-none opacity-60",
          )}
        >
          <MemoryFilterChip
            active={scopeKind === "general"}
            kind="general"
            onClick={() => setScopeKind("general")}
          >
            {t("knowledge.sections.memory.general")}
          </MemoryFilterChip>
          {emailAccounts.map((a) => (
            <MemoryFilterChip
              key={a.id}
              active={scopeKind === "account" && accountId === a.id}
              kind="account"
              color={accountColor(a.id)}
              onClick={() => {
                setScopeKind("account");
                setAccountId(a.id);
              }}
              title={a.name}
            >
              {a.name.split("@")[0]}
            </MemoryFilterChip>
          ))}
          <MemoryFilterChip
            active={scopeKind === "contact"}
            onClick={() => setScopeKind("contact")}
          >
            {t("knowledge.sections.memory.contact")}
          </MemoryFilterChip>
        </fieldset>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {value.length >= MEMORY_COUNTER_THRESHOLD && (
            <span
              className={cn(
                "tabular-nums text-2xs",
                value.length >= MEMORY_MAX_LENGTH ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {value.length}/{MEMORY_MAX_LENGTH}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={save} disabled={!canSave} loading={busy}>
            {t("memory.save")}
          </Button>
        </div>
      </div>
      {scopeKind === "contact" && (
        <Input
          ref={contactInputRef}
          value={contactAddress}
          onChange={(e) => setContactAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          disabled={busy}
          placeholder={t("knowledge.sections.memory.contactPlaceholder")}
          aria-label={t("knowledge.sections.memory.contactPlaceholder")}
          className="text-sm"
        />
      )}
    </div>
  );
}

export function MemoryRow({
  entry,
  onChanged,
  highlighted,
  contactLabel,
  resolveColor,
  emailAccounts,
}: {
  entry: MemoryEntry;
  onChanged: () => Promise<void>;
  /** True when opened via the search palette — draws attention with a soft accent fill. */
  highlighted?: boolean;
  /** The address for `entry.contactId`, or null. */
  contactLabel: string | null;
  /** Resolves any account's dot color (falls back to grey) for the edit card's scope chips. */
  resolveColor: (accountId: string) => string | undefined;
  /** Choices for the edit card's scope chips: one per email account (plus General, always offered). */
  emailAccounts: ConnectedAccount[];
}) {
  const { t, i18n } = useTranslation();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const save = async (content: string, accountId: string | null, contactId: string | null) => {
    setSaving(true);
    try {
      await api.updateMemory(entry.id, content, accountId, contactId);
      setEditing(false);
      await onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteMemory(entry.id);
      await onChanged();
    } catch (err) {
      toast.error(err);
      setDeleting(false);
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    // No per-row icon tile: the same Brain glyph twenty times over says
    // nothing the section head hasn't already said. This wrapper carries no
    // styling of its own — the editor card and the display row each draw
    // their own background, so the two never nest.
    <div data-memory-id={entry.id}>
      {editing ? (
        <MemoryEditor
          initialContent={entry.content}
          initialAccountId={entry.accountId}
          initialContactId={entry.contactId}
          emailAccounts={emailAccounts}
          accountColor={resolveColor}
          busy={saving}
          onSave={(content, accountId, contactId) => void save(content, accountId, contactId)}
          onCancel={() => setEditing(false)}
          ariaLabel={t("memory.edit")}
          placeholder={t("memory.addPlaceholder")}
        />
      ) : (
        <div
          className={cn(
            // Bare row inside the white card — spacing and the hover fill do the
            // separating (the list convention), so a long strip reads as a quiet
            // list rather than a stack of grey boxes.
            "group flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors hover:bg-surface-2",
            highlighted && "bg-accent/10",
          )}
        >
          {/* No per-row scope mark: the row sits under its group's header,
              which already carries the dot and the label. */}
          <InlineEditButton
            onClick={() => setEditing(true)}
            data-tooltip={t("memory.edit")}
            className="text-sm leading-relaxed text-foreground/90"
          >
            {entry.content}
          </InlineEditButton>
          {contactLabel !== null && (
            // The Contacts group header is generic, so the row itself names
            // the person the fact is about.
            <span
              data-tooltip={entry.contactId}
              className="max-w-36 shrink-0 truncate text-xs text-muted-foreground"
            >
              {contactLabel}
            </span>
          )}
          {/* How often the agent has reported leaning on this fact — the signal
              for which entries earn their place. Silent until the fact has been
              used at least once: a strip of zero counters says nothing. The
              tooltip carries when it was last used. */}
          {entry.usedCount > 0 && (
            <span
              data-tooltip={t("memory.lastUsed", {
                time: relativeTime(entry.lastUsedAt as string, i18n.language),
              })}
              className="shrink-0 tabular text-2xs text-muted-foreground"
            >
              {t("memory.usedTimes", { count: entry.usedCount })}
            </span>
          )}
          {/* Quick path that skips the edit card entirely — harmless next to
              the edit card's own delete button, since only one is ever on
              screen for a given row at a time. */}
          <HoverActions>
            <Button
              variant="ghost-danger"
              size="icon-sm"
              onClick={() => setConfirmOpen(true)}
              aria-label={t("memory.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </HoverActions>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("memory.delete")}
        description={t("memory.deleteConfirm")}
        confirmLabel={t("memory.delete")}
        busy={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
