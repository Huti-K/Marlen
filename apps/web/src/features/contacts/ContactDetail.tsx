import {
  CONTACT_CATEGORIES,
  type ContactCategory,
  type ContactDetail as ContactDetailData,
} from "@trailin/shared";
import { ChevronLeft, ExternalLink, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { RetryableError } from "@/components/ui/feedback";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar, categoryLabel } from "@/features/contacts/shared";
import { api } from "@/lib/api";
import { dateTimeLabel, relativeTime } from "@/lib/dates";
import { useServerEvents } from "@/lib/serverEvents";
import { toast } from "@/lib/toast";
import { errorMessage, openExternal } from "@/lib/utils";

/**
 * One contact's full record, held in a single elevated card: header, the
 * manual overrides (name + category), recent threads, and a soft-delete. Swaps
 * in for the People list inside ContactsPanel — a single-pane drill-down, not a
 * dialog. Rows inside the card recess (bare/`surface-2`) so the card is the one
 * raised surface (no card-in-card).
 */
export function ContactDetail({ address, onBack }: { address: string; onBack: () => void }) {
  const { t, i18n } = useTranslation();
  const [detail, setDetail] = React.useState<ContactDetailData | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [nameDraft, setNameDraft] = React.useState("");
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const load = React.useCallback(() => {
    api
      .contactDetail(address)
      .then((data) => {
        setDetail(data);
        setLoadError(null);
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [address]);

  React.useEffect(() => {
    setDetail(null);
    setLoadError(null);
    load();
  }, [load]);

  useServerEvents(["contacts"], load);

  // Seed the editable name from the server value. Typing only moves the local
  // draft (never detail.displayName), so this doesn't fire mid-edit — it
  // re-seeds only when the stored name actually changes (a save, or a new
  // contact opened).
  React.useEffect(() => {
    setNameDraft(detail?.displayName ?? "");
  }, [detail?.displayName]);

  const updateCategory = async (value: string) => {
    if (!detail) return;
    const category = value as ContactCategory;
    const previous = detail;
    setDetail({ ...detail, category, categorySource: "user" });
    try {
      const updated = await api.setContactCategory(address, category);
      setDetail((current) => (current ? { ...current, ...updated } : current));
    } catch (err) {
      toast.error(err);
      setDetail(previous);
    }
  };

  const saveName = async () => {
    if (!detail) return;
    const next = nameDraft.trim();
    if (next === detail.displayName.trim()) return;
    try {
      const updated = await api.setContactName(address, next);
      setDetail((current) => (current ? { ...current, ...updated } : current));
      setNameDraft(updated.displayName);
    } catch (err) {
      toast.error(err);
      setNameDraft(detail.displayName);
    }
  };

  const removeContact = async () => {
    setDeleting(true);
    try {
      await api.deleteContact(address);
      onBack();
    } catch (err) {
      toast.error(err);
      setDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="w-fit">
        <ChevronLeft className="h-4 w-4" />
        {t("contacts.detail.back")}
      </Button>

      {!detail ? (
        loadError ? (
          <RetryableError onRetry={load}>{loadError}</RetryableError>
        ) : (
          <Card padding="lg" className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-56 rounded-lg" />
          </Card>
        )
      ) : (
        <Card padding="lg" className="flex flex-col gap-6">
          <header className="flex items-start gap-3">
            <ContactAvatar
              label={detail.displayName || detail.address}
              className="h-12 w-12 text-base"
            />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold tracking-tight">
                {detail.displayName || detail.address}
              </h2>
              <p className="truncate text-sm text-muted-foreground">{detail.address}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{t("contacts.detail.messages", { count: detail.messageCount })}</span>
                <span aria-hidden>·</span>
                <span>{t("contacts.detail.sent", { count: detail.sentCount })}</span>
                {/* Blank for a manually added contact until mail arrives. */}
                {detail.lastContactAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {t("contacts.detail.lastContact", {
                        when: relativeTime(detail.lastContactAt, i18n.language),
                      })}
                    </span>
                  </>
                )}
              </p>
            </div>
            <Button
              variant="ghost-danger"
              size="icon-sm"
              className="shrink-0"
              onClick={() => setConfirmOpen(true)}
              title={t("contacts.detail.delete")}
              aria-label={t("contacts.detail.delete")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </header>

          {detail.gist && <p className="text-sm text-muted-foreground">{detail.gist}</p>}

          <FormField
            id="contact-name"
            label={t("contacts.detail.nameLabel")}
            hint={t("contacts.detail.nameHint")}
            className="max-w-sm"
          >
            <Input
              id="contact-name"
              value={nameDraft}
              placeholder={t("contacts.detail.namePlaceholder")}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </FormField>

          <FormField
            id="contact-category"
            label={t("contacts.detail.categoryLabel")}
            hint={
              detail.categorySource === "user"
                ? t("contacts.detail.categorySourceUser")
                : t("contacts.detail.categorySourceAuto")
            }
            className="max-w-sm"
          >
            <Select
              id="contact-category"
              value={detail.category}
              onChange={(value) => void updateCategory(value)}
              options={CONTACT_CATEGORIES.map((cat) => ({
                value: cat,
                label: categoryLabel(t, cat),
              }))}
            />
          </FormField>

          <section className="flex flex-col gap-2.5">
            <h3 className="text-sm font-semibold tracking-tight">
              {t("contacts.detail.threadsTitle")}
            </h3>
            {detail.recentThreads.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("contacts.detail.noThreads")}</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {detail.recentThreads.map((thread) => (
                  <div
                    key={`${thread.accountId}-${thread.threadId}`}
                    className="flex items-center gap-3 rounded-lg bg-surface-2 px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {thread.subject || t("drafts.noSubject")}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {dateTimeLabel(thread.date, i18n.language)}
                        {thread.gist && ` · ${thread.gist}`}
                      </p>
                    </div>
                    {thread.webUrl && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0"
                        onClick={() => openExternal(thread.webUrl)}
                        title={t("drafts.open")}
                        aria-label={t("drafts.open")}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <ConfirmDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title={t("contacts.detail.deleteConfirmTitle", {
              name: detail.displayName || detail.address,
            })}
            description={t("contacts.detail.deleteConfirmBody", {
              name: detail.displayName || detail.address,
            })}
            confirmLabel={t("contacts.detail.delete")}
            busy={deleting}
            onConfirm={() => void removeContact()}
          />
        </Card>
      )}
    </div>
  );
}
