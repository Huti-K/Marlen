import type { ConnectedAccountWithSync, Contact } from "@trailin/shared";
import { ChevronLeft, Loader2, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * Full-page compose — a drill-down inside EmailPanel, like ThreadView.
 * Saving creates a provider draft with exactly what was typed (the account's
 * signature is prefilled into the body, visible and editable) and lands in
 * the Drafts lane, where DraftRow owns editing and the one send path.
 * Accounts without a draft provider never reach this view — EmailPanel
 * filters to draft-capable mailboxes.
 */
export function ComposeView({
  accounts,
  initialAccountId,
  onBack,
  onSaved,
}: {
  /** Draft-capable mailboxes only. */
  accounts: ConnectedAccountWithSync[];
  initialAccountId?: string;
  onBack: () => void;
  onSaved: (accountId: string, draftId: string) => void;
}) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = React.useState(() => initialAccountId ?? accounts[0]?.id ?? "");
  const [to, setTo] = React.useState<string[]>([]);
  const [cc, setCc] = React.useState<string[]>([]);
  const [bcc, setBcc] = React.useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  // The signature block last auto-inserted, so switching accounts replaces an
  // untouched prefill instead of clobbering typed text.
  const prefillRef = React.useRef("");
  const [signatures, setSignatures] = React.useState<Map<string, string>>(new Map());

  React.useEffect(() => {
    api
      .accountVoices()
      .then(({ voices }) => {
        setSignatures(new Map(voices.map((v) => [v.accountId, v.signature ?? ""])));
      })
      .catch(() => {});
  }, []);

  // Prefill "\n\n<signature>" for the picked account; only while the body is
  // still empty or exactly the previous prefill.
  React.useEffect(() => {
    const signature = signatures.get(accountId);
    const next = signature ? `\n\n${signature}` : "";
    setBody((current) => {
      if (current !== "" && current !== prefillRef.current) return current;
      prefillRef.current = next;
      return next;
    });
  }, [accountId, signatures]);

  if (accounts.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <BackButton onBack={onBack} />
        <EmptyState icon={X} description={t("email.compose.noAccounts")} />
      </div>
    );
  }

  const canSave = to.length > 0 && accountId !== "" && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const created = await api.composeDraft(accountId, {
        to,
        ...(cc.length > 0 ? { cc } : {}),
        ...(bcc.length > 0 ? { bcc } : {}),
        subject,
        body,
      });
      toast.success(t("email.compose.savedToast"));
      onSaved(accountId, created.draftId);
    } catch (err) {
      toast.error(err);
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <BackButton onBack={onBack} />

      <div className="surface flex flex-col gap-4 rounded-xl p-5">
        <h2 className="text-base font-semibold tracking-tight">{t("email.compose.title")}</h2>

        <FormField id="compose-account" label={t("email.compose.from")}>
          <Select
            id="compose-account"
            value={accountId}
            onChange={setAccountId}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </FormField>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="compose-to" className="text-xs font-medium text-muted-foreground">
              {t("email.compose.to")}
            </label>
            {!showCcBcc && (
              <button
                type="button"
                onClick={() => setShowCcBcc(true)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("email.compose.showCcBcc")}
              </button>
            )}
          </div>
          <RecipientField id="compose-to" recipients={to} onChange={setTo} autoFocus />
        </div>

        {showCcBcc && (
          <>
            <FormField id="compose-cc" label={t("email.compose.cc")}>
              <RecipientField id="compose-cc" recipients={cc} onChange={setCc} />
            </FormField>
            <FormField id="compose-bcc" label={t("email.compose.bcc")}>
              <RecipientField id="compose-bcc" recipients={bcc} onChange={setBcc} />
            </FormField>
          </>
        )}

        <FormField id="compose-subject" label={t("email.compose.subject")}>
          <Input
            id="compose-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("email.compose.subjectPlaceholder")}
          />
        </FormField>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("email.compose.bodyPlaceholder")}
          rows={Math.max(10, body.split("\n").length)}
          aria-label={t("email.compose.bodyLabel")}
          className="resize-none text-sm leading-relaxed"
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={!canSave}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("email.compose.saveDraft")}
          </Button>
        </div>
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
      <ChevronLeft className="h-4 w-4" />
      {t("email.thread.back")}
    </Button>
  );
}

/**
 * Address chip input: typed addresses commit on Enter/comma/blur, contact
 * suggestions (mailbox-derived, see /api/contacts) surface after two typed
 * characters. Backspace on an empty field removes the last chip.
 */
function RecipientField({
  id,
  recipients,
  onChange,
  autoFocus,
}: {
  id: string;
  recipients: string[];
  onChange: (next: string[]) => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [text, setText] = React.useState("");
  const [suggestions, setSuggestions] = React.useState<Contact[]>([]);
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    const q = text.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const requestId = ++requestRef.current;
    const timer = setTimeout(() => {
      api
        .contacts({ q })
        .then((rows) => {
          if (requestRef.current !== requestId) return;
          setSuggestions(rows.filter((c) => !recipients.includes(c.address)).slice(0, 5));
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [text, recipients]);

  const add = (address: string) => {
    const clean = address.trim().replace(/,$/, "").toLowerCase();
    if (!clean.includes("@") || recipients.includes(clean)) return;
    onChange([...recipients, clean]);
    setText("");
    setSuggestions([]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      if (text.trim()) {
        e.preventDefault();
        add(text);
      }
    } else if (e.key === "Backspace" && text === "" && recipients.length > 0) {
      onChange(recipients.slice(0, -1));
    } else if (e.key === "Escape") {
      setSuggestions([]);
    }
  };

  return (
    <div className="relative flex flex-col gap-1.5">
      {recipients.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {recipients.map((address) => (
            <span
              key={address}
              className="flex h-7 items-center gap-1 rounded-full bg-surface-2 pl-2.5 pr-1 text-xs"
            >
              <span className="max-w-56 truncate">{address}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onChange(recipients.filter((r) => r !== address))}
                aria-label={t("email.compose.removeRecipient", { address })}
              >
                <X className="h-3 w-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (text.trim()) add(text);
        }}
        placeholder={t("email.compose.recipientPlaceholder")}
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {suggestions.length > 0 && (
        <div className="surface-pop absolute top-full z-20 mt-1 w-full overflow-hidden rounded-lg p-1">
          {suggestions.map((contact) => (
            <button
              key={contact.address}
              type="button"
              // onMouseDown so the pick lands before the input's blur commits the raw text.
              onMouseDown={(e) => {
                e.preventDefault();
                add(contact.address);
              }}
              className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-2"
            >
              <span className="truncate">{contact.displayName || contact.address}</span>
              {contact.displayName && (
                <span className="truncate text-xs text-muted-foreground">{contact.address}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
