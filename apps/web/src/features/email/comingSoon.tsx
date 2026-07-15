import { Archive, FolderInput, Forward, MailOpen, Tags, Trash2 } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

/**
 * The Email page's seam for mailbox mutations the server can't perform yet
 * (there is no provider/route layer for them — they exist only as agent-side
 * MCP tools). Every such button in the page renders as a MailboxActionButton
 * and dispatches through useMailboxAction()'s `run` — the one place to
 * replace an arm with a real API call when server support lands. Nothing
 * else may open the coming-soon dialog.
 */

export type MailboxAction = "archive" | "delete" | "move" | "labels" | "markUnread" | "forward";

/** Where the action was invoked — the future real implementation's arguments. */
export interface MailboxActionContext {
  accountId: string;
  threadId: string;
  messageId?: string;
}

type RunMailboxAction = (action: MailboxAction, ctx: MailboxActionContext) => void;

const ComingSoonContext = React.createContext<RunMailboxAction>(() => {});

/** Dispatch point for every mailbox action; today each arm opens the dialog. */
export function useMailboxAction(): RunMailboxAction {
  return React.useContext(ComingSoonContext);
}

/** Mounted once by EmailPanel: owns the single coming-soon dialog. */
export function ComingSoonProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = React.useState<MailboxAction | null>(null);

  // Every action is a stub today. When one becomes real, replace its arm
  // here with the API call; the buttons and their placement stay as-is.
  const run = React.useCallback<RunMailboxAction>((action, _ctx) => {
    setPending(action);
  }, []);

  return (
    <ComingSoonContext.Provider value={run}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending ? t(`email.actions.${pending}`) : ""}
        footer={<Button onClick={() => setPending(null)}>{t("common.close")}</Button>}
      >
        <p className="text-sm text-muted-foreground">{t("email.comingSoon")}</p>
      </Dialog>
    </ComingSoonContext.Provider>
  );
}

const ACTION_ICONS: Record<MailboxAction, React.ComponentType<{ className?: string }>> = {
  archive: Archive,
  delete: Trash2,
  move: FolderInput,
  labels: Tags,
  markUnread: MailOpen,
  forward: Forward,
};

/** One mailbox-action icon button; visually a normal action, wired to the seam above. */
export function MailboxActionButton({
  action,
  ctx,
}: {
  action: MailboxAction;
  ctx: MailboxActionContext;
}) {
  const { t } = useTranslation();
  const run = useMailboxAction();
  const Icon = ACTION_ICONS[action];
  const label = t(`email.actions.${action}`);
  return (
    <Button
      variant={action === "delete" ? "ghost-danger" : "ghost"}
      size="icon-sm"
      onClick={() => run(action, ctx)}
      title={label}
      aria-label={label}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
