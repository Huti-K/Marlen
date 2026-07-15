import {
  type AccountColor,
  type AccountDrafts,
  type ConnectedAccountWithSync,
  EMAIL_APPS,
  type MailThreadOverview,
} from "@trailin/shared";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Chip } from "@/components/ui/chip";
import { ErrorBanner } from "@/components/ui/feedback";
import { Select } from "@/components/ui/select";
import { ComposeView } from "@/features/email/ComposeView";
import { ComingSoonProvider } from "@/features/email/comingSoon";
import { DraftsLane } from "@/features/email/DraftsLane";
import { InboxLane } from "@/features/email/InboxLane";
import { ThreadView } from "@/features/email/ThreadView";
import { api } from "@/lib/api";
import { useServerEvents } from "@/lib/serverEvents";
import { errorMessage } from "@/lib/utils";

const isEmailApp = (slug: string) => (EMAIL_APPS as readonly string[]).includes(slug);

type Lane = "inbox" | "drafts";

/** What fills the panel: the lanes, one thread, or the compose form. */
type PanelView =
  | { kind: "list" }
  | { kind: "thread"; accountId: string; threadId: string }
  | { kind: "compose"; accountId?: string };

/**
 * Stale-while-revalidate cache, same reason as HomePanel's: the route
 * unmounts on navigation, and the drafts fan-out can take seconds cold.
 * Module-level so it survives unmount/remount.
 */
const cache: {
  accounts: ConnectedAccountWithSync[] | null;
  colors: AccountColor[];
  drafts: AccountDrafts[] | null;
} = { accounts: null, colors: [], drafts: null };

/**
 * Email: the mailbox mirror as a page. Inbox and Drafts lanes switched by
 * the chip row; a thread or the compose form swaps the whole panel — a
 * single-pane drill-down like ContactsPanel. Reading is mirror-local
 * (works offline, trails live mail by the sync interval); drafts are
 * provider-live. Mailbox mutations beyond reply/compose are stubs behind
 * the coming-soon seam (comingSoon.tsx) until the server grows them.
 */
export function EmailPanel() {
  const { t } = useTranslation();
  const [lane, setLane] = React.useState<Lane>("inbox");
  const [view, setView] = React.useState<PanelView>({ kind: "list" });
  // "all" or a connected-account id; scopes the inbox lane.
  const [accountFilter, setAccountFilter] = React.useState("all");
  const [accounts, setAccounts] = React.useState<ConnectedAccountWithSync[] | null>(cache.accounts);
  const [colors, setColors] = React.useState<AccountColor[]>(cache.colors);
  const [drafts, setDrafts] = React.useState<AccountDrafts[] | null>(cache.drafts);
  const [error, setError] = React.useState<string | null>(null);
  // A just-created reply/compose draft, expanded on arrival in the Drafts lane.
  const [focusDraftId, setFocusDraftId] = React.useState<string | null>(null);

  const loadToken = React.useRef(0);

  const load = React.useCallback(async () => {
    setError(null);
    const token = ++loadToken.current;
    const isCurrent = () => loadToken.current === token;
    const apply = <T,>(promise: Promise<T>, onFulfilled: (value: T) => void) =>
      promise.then((value) => {
        if (isCurrent()) onFulfilled(value);
      });

    const results = await Promise.allSettled([
      apply(api.pipedreamAccounts(), (all) => {
        const mail = all.filter((a) => isEmailApp(a.app));
        cache.accounts = mail;
        setAccounts(mail);
      }),
      apply(api.accountColors(), (v) => {
        cache.colors = v.colors;
        setColors(v.colors);
      }),
      apply(api.drafts(), (v) => {
        cache.drafts = v;
        setDrafts(v);
      }),
    ]);

    if (!isCurrent()) return;
    const failed = results.find((x) => x.status === "rejected");
    setError(failed ? errorMessage(failed.reason) : null);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);
  useServerEvents(["drafts"], () => void load());

  // The drafts response is the server's own "this account has a draft
  // provider" signal — accounts absent from it can't reply or compose.
  // While it's still loading, stay permissive; a failed action toasts.
  const draftCapable = (accountId: string) =>
    drafts === null || drafts.some((a) => a.accountId === accountId);

  const openDraft = (draftId: string) => {
    setFocusDraftId(draftId);
    setLane("drafts");
    setView({ kind: "list" });
    void load();
  };

  if (view.kind === "thread") {
    return (
      <ComingSoonProvider>
        <div className="pt-4">
          <ThreadView
            accountId={view.accountId}
            threadId={view.threadId}
            account={accounts?.find((a) => a.id === view.accountId)}
            color={colors.find((c) => c.accountId === view.accountId)?.hex}
            canReply={draftCapable(view.accountId)}
            onBack={() => setView({ kind: "list" })}
            onReplyStarted={openDraft}
          />
        </div>
      </ComingSoonProvider>
    );
  }

  if (view.kind === "compose") {
    return (
      <div className="pt-4">
        <ComposeView
          accounts={(accounts ?? []).filter((a) => draftCapable(a.id))}
          initialAccountId={view.accountId}
          onBack={() => setView({ kind: "list" })}
          onSaved={(_accountId, draftId) => openDraft(draftId)}
        />
      </div>
    );
  }

  return (
    <ComingSoonProvider>
      <div className="flex flex-col gap-4 pt-4">
        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Chip active={lane === "inbox"} onClick={() => setLane("inbox")}>
              {t("email.lanes.inbox")}
            </Chip>
            <Chip active={lane === "drafts"} onClick={() => setLane("drafts")}>
              {t("email.lanes.drafts")}
            </Chip>
          </div>
          {lane === "inbox" && (accounts?.length ?? 0) > 1 && (
            <Select
              id="email-account-filter"
              value={accountFilter}
              onChange={setAccountFilter}
              aria-label={t("email.accountFilterLabel")}
              className="w-auto"
              options={[
                { value: "all", label: t("email.allAccounts") },
                ...(accounts ?? []).map((a) => ({ value: a.id, label: a.name })),
              ]}
            />
          )}
        </div>

        {lane === "inbox" ? (
          <InboxLane
            accountId={accountFilter === "all" ? undefined : accountFilter}
            accounts={accounts ?? []}
            colors={colors}
            onOpenThread={(thread: MailThreadOverview) =>
              setView({ kind: "thread", accountId: thread.accountId, threadId: thread.threadId })
            }
          />
        ) : (
          <DraftsLane
            drafts={drafts}
            colors={colors}
            onChanged={() => void load()}
            focusDraftId={focusDraftId}
            onCompose={() =>
              setView({
                kind: "compose",
                accountId: accountFilter === "all" ? undefined : accountFilter,
              })
            }
          />
        )}
      </div>
    </ComingSoonProvider>
  );
}
