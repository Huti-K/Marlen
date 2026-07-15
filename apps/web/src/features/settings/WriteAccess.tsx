import type { ConnectedAccount } from "@trailin/shared";
import { Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { ListRow } from "@/components/ui/list-row";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** App logo from Pipedream, falling back to a generic mail glyph — mirrors the connections row icon. */
function AppIcon({ src }: { src?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setFailed(true)}
        className="h-4 w-4 shrink-0 object-contain"
      />
    );
  }
  return <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

/**
 * Per-account write-access list, factored out of ConnectionsPanel so Settings can
 * surface it under its own Permissions section. Arming an account is consequential
 * and gated by a confirm dialog; disarming is immediate.
 */
export function WriteAccess({ onState }: { onState?: (armedCount: number) => void }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = React.useState<ConnectedAccount[] | null>(null);
  const [armedIds, setArmedIds] = React.useState<string[] | null>(null);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [confirmAccount, setConfirmAccount] = React.useState<ConnectedAccount | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);

  const reportState = (accts: ConnectedAccount[], ids: string[]) => {
    onState?.(accts.filter((a) => ids.includes(a.id)).length);
  };

  // Only the initial load — onState is stable enough not to need re-running this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once mount fetch; re-running on every onState identity change would refire the request
  React.useEffect(() => {
    Promise.all([api.pipedreamAccounts(), api.writeAccess()])
      .then(([accts, access]) => {
        setAccounts(accts);
        setArmedIds(access.accountIds);
        reportState(accts, access.accountIds);
      })
      .catch((err) => toast.error(err));
  }, []);

  const persist = async (nextIds: string[]): Promise<void> => {
    const { accountIds: updated } = await api.setWriteAccess(nextIds);
    setArmedIds(updated);
    if (accounts) reportState(accounts, updated);
  };

  const disarm = async (accountId: string) => {
    if (!armedIds) return;
    setSavingId(accountId);
    try {
      await persist(armedIds.filter((id) => id !== accountId));
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const confirmArm = async () => {
    if (!confirmAccount || !armedIds) return;
    setConfirmBusy(true);
    try {
      await persist([...armedIds, confirmAccount.id]);
      setConfirmAccount(null);
    } catch (err) {
      toast.error(err);
    } finally {
      setConfirmBusy(false);
    }
  };

  // Arming send/change access for an account is consequential, so confirm it
  // first; turning it back off is safe and immediate.
  const handleToggle = (account: ConnectedAccount, next: boolean) => {
    if (next) setConfirmAccount(account);
    else void disarm(account.id);
  };

  if (!accounts || !armedIds) return null;

  return (
    <>
      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("settings.permissions.noAccounts")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((account) => {
            const armed = armedIds.includes(account.id);
            const switchId = `write-access-${account.id}`;
            return (
              <ListRow
                key={account.id}
                className={cn("py-2.5 transition-colors", armed && "bg-warning/10")}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <AppIcon src={account.imgSrc} />
                  <div className="min-w-0">
                    <Label htmlFor={switchId} className="truncate text-sm font-medium">
                      {account.name}
                    </Label>
                    <p
                      className={cn(
                        "flex items-center gap-1 text-xs",
                        armed ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {armed ? (
                        <TriangleAlert className="h-3 w-3 shrink-0" />
                      ) : (
                        <ShieldCheck className="h-3 w-3 shrink-0" />
                      )}
                      {armed ? t("settings.permissions.rowOn") : t("settings.permissions.rowOff")}
                    </p>
                  </div>
                </div>
                <Switch
                  id={switchId}
                  tone="warning"
                  checked={armed}
                  disabled={savingId === account.id}
                  onCheckedChange={(next) => handleToggle(account, next)}
                />
              </ListRow>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmAccount !== null}
        onOpenChange={(next) => !confirmBusy && !next && setConfirmAccount(null)}
        title={t("settings.permissions.confirmTitle", { account: confirmAccount?.name ?? "" })}
        description={t("settings.permissions.confirmBody", {
          account: confirmAccount?.name ?? "",
        })}
        confirmLabel={t("settings.permissions.confirmCta")}
        busy={confirmBusy}
        onConfirm={() => void confirmArm()}
      />
    </>
  );
}
