import type { FileAccessSettings } from "@trailin/shared";
import { Eye, HardDrive, SquarePen, TerminalSquare } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Section } from "@/components/ui/section-header";
import { ArmedSwitchRow } from "@/features/connections/AccountPermissions";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * The assistant's filesystem grants: three armed switches — read, write,
 * run commands — each whole-filesystem, mirroring the per-account permission
 * editor's confirm-to-arm / instant-disarm flow. Grants auto-save on change.
 */

const rowIcon = "h-4 w-4 shrink-0 text-muted-foreground";

type GrantKey = keyof FileAccessSettings;
const GRANT_KEYS: readonly GrantKey[] = ["read", "write", "bash"];

export function FileAccessSection({ index }: { index: number }) {
  const { t } = useTranslation();
  const [grants, setGrants] = React.useState<FileAccessSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmKey, setConfirmKey] = React.useState<GrantKey | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);

  React.useEffect(() => {
    api
      .fileAccess()
      .then((r) => setGrants(r.fileAccess))
      .catch(() => {});
  }, []);

  const persist = async (next: FileAccessSettings) => {
    setSaving(true);
    try {
      const { fileAccess: saved } = await api.setFileAccess(next);
      setGrants(saved);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const copy: Record<
    GrantKey,
    {
      icon: React.ReactNode;
      title: string;
      on: string;
      off: string;
      confirmTitle: string;
      confirmBody: string;
      confirmCta: string;
    }
  > = {
    read: {
      icon: <Eye className={rowIcon} />,
      title: t("settings.fileAccess.read.title"),
      on: t("settings.fileAccess.read.on"),
      off: t("settings.fileAccess.read.off"),
      confirmTitle: t("settings.fileAccess.read.confirmTitle"),
      confirmBody: t("settings.fileAccess.read.confirmBody"),
      confirmCta: t("settings.fileAccess.read.confirmCta"),
    },
    write: {
      icon: <SquarePen className={rowIcon} />,
      title: t("settings.fileAccess.write.title"),
      on: t("settings.fileAccess.write.on"),
      off: t("settings.fileAccess.write.off"),
      confirmTitle: t("settings.fileAccess.write.confirmTitle"),
      confirmBody: t("settings.fileAccess.write.confirmBody"),
      confirmCta: t("settings.fileAccess.write.confirmCta"),
    },
    bash: {
      icon: <TerminalSquare className={rowIcon} />,
      title: t("settings.fileAccess.bash.title"),
      on: t("settings.fileAccess.bash.on"),
      off: t("settings.fileAccess.bash.off"),
      confirmTitle: t("settings.fileAccess.bash.confirmTitle"),
      confirmBody: t("settings.fileAccess.bash.confirmBody"),
      confirmCta: t("settings.fileAccess.bash.confirmCta"),
    },
  };

  const confirmArm = async () => {
    if (!confirmKey || !grants) return;
    setConfirmBusy(true);
    try {
      await persist({ ...grants, [confirmKey]: true });
      setConfirmKey(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  const armedLabels = grants
    ? GRANT_KEYS.filter((key) => grants[key]).map((key) =>
        t(`settings.fileAccess.${key}.badge` as const),
      )
    : [];
  const chip = !grants ? null : armedLabels.length > 0 ? (
    <Badge variant="warning">{armedLabels.join(" · ")}</Badge>
  ) : (
    <Badge variant="muted">{t("settings.fileAccess.chipOff")}</Badge>
  );

  return (
    <Section
      index={index}
      className="animate-in-up"
      icon={<HardDrive />}
      title={t("settings.fileAccess.title")}
      description={t("settings.fileAccess.description")}
      aside={chip}
    >
      <div className="flex flex-col gap-2">
        {grants &&
          GRANT_KEYS.map((key) => (
            <ArmedSwitchRow
              key={key}
              switchId={`file-access-${key}`}
              icon={copy[key].icon}
              title={copy[key].title}
              armed={grants[key]}
              statusOn={copy[key].on}
              statusOff={copy[key].off}
              disabled={saving}
              onToggle={(next) =>
                next ? setConfirmKey(key) : void persist({ ...grants, [key]: false })
              }
            />
          ))}
      </div>
      <ConfirmDialog
        open={confirmKey !== null}
        onOpenChange={(next) => !confirmBusy && !next && setConfirmKey(null)}
        title={confirmKey ? copy[confirmKey].confirmTitle : ""}
        description={confirmKey ? copy[confirmKey].confirmBody : ""}
        confirmLabel={confirmKey ? copy[confirmKey].confirmCta : ""}
        busy={confirmBusy}
        onConfirm={() => void confirmArm()}
      />
    </Section>
  );
}
