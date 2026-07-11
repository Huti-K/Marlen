import { ShieldCheck, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { ListRow } from "@/components/ui/list-row";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

/**
 * The write-access toggle, factored out of ConnectionsPanel so Settings can
 * surface it under its own Permissions section. Behavior is unchanged: enabling
 * is consequential and gated by a confirm dialog, disabling is immediate.
 */
export function WriteAccess({ onState }: { onState?: (allow: boolean) => void }) {
  const { t } = useTranslation();
  const [allowWrite, setAllowWrite] = React.useState<boolean | null>(null);

  // Only the initial load — onState is stable enough not to need re-running this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run-once mount fetch; re-running on every onState identity change would refire the request
  React.useEffect(() => {
    api
      .emailWrite()
      .then((r) => {
        setAllowWrite(r.allowWrite);
        onState?.(r.allowWrite);
      })
      .catch((err) => toast.error(errorMessage(err)));
  }, []);

  const toggleWrite = async (next: boolean) => {
    try {
      const { allowWrite: updated } = await api.setEmailWrite(next);
      setAllowWrite(updated);
      onState?.(updated);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // Enabling send/change access is consequential, so confirm it first; turning
  // it back off is safe and immediate.
  const [confirmWrite, setConfirmWrite] = React.useState(false);
  const [writeBusy, setWriteBusy] = React.useState(false);

  const handleWriteToggle = (next: boolean) => {
    if (next) setConfirmWrite(true);
    else void toggleWrite(false);
  };

  const confirmEnableWrite = async () => {
    setWriteBusy(true);
    await toggleWrite(true);
    setWriteBusy(false);
    setConfirmWrite(false);
  };

  return (
    <>
      <ListRow
        className={cn(
          "py-2.5 transition-colors",
          // Armed = the agent can send/delete. Tint the whole row amber so it
          // reads as a live danger zone, not a neutral setting.
          allowWrite && "bg-warning/10",
        )}
      >
        <div className="min-w-0">
          <Label
            htmlFor="pd-write-toggle"
            className="flex items-center gap-1.5 text-sm font-medium"
          >
            {allowWrite ? (
              <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-warning" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-success" />
            )}
            {t("settings.permissions.toggle")}
          </Label>
          <p className={cn("text-xs", allowWrite ? "text-warning" : "text-muted-foreground")}>
            {allowWrite ? t("settings.permissions.toggleOn") : t("settings.permissions.toggleOff")}
          </p>
        </div>
        <Switch
          id="pd-write-toggle"
          tone="warning"
          checked={allowWrite ?? false}
          disabled={allowWrite === null}
          onCheckedChange={handleWriteToggle}
        />
      </ListRow>

      <ConfirmDialog
        open={confirmWrite}
        onOpenChange={(next) => !writeBusy && setConfirmWrite(next)}
        title={t("settings.permissions.confirmTitle")}
        description={t("settings.permissions.confirmBody")}
        confirmLabel={t("settings.permissions.confirmCta")}
        variant="destructive"
        busy={writeBusy}
        onConfirm={() => void confirmEnableWrite()}
      />
    </>
  );
}
