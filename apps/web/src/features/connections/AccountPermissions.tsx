import type { AccountPermissions, ConnectedAccount } from "@trailin/shared";
import { SendHorizontal, ShieldCheck, SquarePen, Trash2, TriangleAlert } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SettingRow } from "@/components/ui/setting-row";
import { Switch } from "@/components/ui/switch";
import { isEmailApp } from "@/lib/accounts";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * Per-account permission editor, expanded under an account's row in the
 * connected-accounts list. Reading is always allowed; the three grants
 * mirror the server's verb classification (pipedream/mcp.ts): `write` arms
 * create/change tools, `send` outward communication, `delete` destructive
 * verbs. Arming a grant is consequential and gated by a confirm dialog;
 * disarming is immediate.
 */

/** The grantable categories of one account's permission record. */
export type PermissionKey = "write" | "send" | "delete";
const PERMISSION_KEYS: readonly PermissionKey[] = ["write", "send", "delete"];

export type PermissionGrants = Omit<AccountPermissions, "accountId">;

export const READ_ONLY_GRANTS: PermissionGrants = { write: false, send: false, delete: false };

/**
 * One armable permission row: warning-tinted while on, with the
 * ShieldCheck/TriangleAlert status line and a warning-toned switch. Arming
 * flows through the caller's confirm step; disarming is immediate.
 */
export function ArmedSwitchRow({
  switchId,
  icon,
  title,
  armed,
  statusOn,
  statusOff,
  disabled,
  bare,
  onToggle,
}: {
  switchId: string;
  icon: React.ReactNode;
  title: string;
  armed: boolean;
  statusOn: string;
  statusOff: string;
  disabled?: boolean;
  /** Render as a bare row inside an already-raised surface. */
  bare?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <SettingRow
      htmlFor={switchId}
      icon={icon}
      label={title}
      bare={bare}
      className={cn(
        "py-2.5 transition-colors",
        bare && "rounded-lg px-2",
        armed && "bg-warning/10",
      )}
      description={
        <span className={cn("flex items-center gap-1", armed && "text-warning")}>
          {armed ? (
            <TriangleAlert className="h-3 w-3 shrink-0" />
          ) : (
            <ShieldCheck className="h-3 w-3 shrink-0" />
          )}
          {armed ? statusOn : statusOff}
        </span>
      }
    >
      <Switch
        id={switchId}
        tone="warning"
        checked={armed}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </SettingRow>
  );
}

/** An integration toggle's copy, resolved by the caller so keys stay literal for i18next's typing. */
export interface ArmedToggleTexts {
  title: string;
  rowOn: string;
  rowOff: string;
  confirmTitle: string;
  confirmBody: string;
  confirmCta: string;
}

/**
 * One self-persisting armable grant: ArmedSwitchRow plus the arm-with-confirm,
 * disarm-immediately flow, saving through the caller's endpoint. Used by the
 * integration rows (onOffice, WhatsApp) whose grants each persist on their
 * own — the per-account editor below saves a whole record instead.
 */
export function ArmedToggleRow({
  switchId,
  icon,
  armed,
  persist,
  onChanged,
  texts,
}: {
  switchId: string;
  icon: React.ReactNode;
  armed: boolean;
  persist: (enabled: boolean) => Promise<unknown>;
  onChanged: () => Promise<void>;
  texts: ArmedToggleTexts;
}) {
  const [saving, setSaving] = React.useState(false);
  const [confirmArm, setConfirmArm] = React.useState(false);

  const save = async (enabled: boolean) => {
    setSaving(true);
    try {
      await persist(enabled);
      await onChanged();
      setConfirmArm(false);
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ArmedSwitchRow
        bare
        switchId={switchId}
        icon={icon}
        title={texts.title}
        armed={armed}
        statusOn={texts.rowOn}
        statusOff={texts.rowOff}
        disabled={saving}
        onToggle={(next) => (next ? setConfirmArm(true) : void save(false))}
      />

      <ConfirmDialog
        open={confirmArm}
        onOpenChange={(next) => !saving && !next && setConfirmArm(false)}
        title={texts.confirmTitle}
        description={texts.confirmBody}
        confirmLabel={texts.confirmCta}
        busy={saving}
        onConfirm={() => void save(true)}
      />
    </>
  );
}

/** The copy of one grant's row + confirm dialog, resolved with literal keys for i18next's typing. */
interface PermissionCopy {
  icon: React.ReactNode;
  title: string;
  on: string;
  off: string;
  confirmTitle: string;
  confirmBody: string;
  confirmCta: string;
}

const rowIcon = "h-4 w-4 shrink-0 text-muted-foreground";

export function AccountPermissionsEditor({
  account,
  granted,
  onPersist,
}: {
  account: ConnectedAccount;
  granted: PermissionGrants;
  /** Persist this account's full grant record; rejections surface as a toast. */
  onPersist: (next: PermissionGrants) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = React.useState(false);
  const [confirmKey, setConfirmKey] = React.useState<PermissionKey | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);

  const name = account.name;
  // The copy is app-generic; email accounts get the draft-aware variants so
  // "cannot change/send" never reads as "no drafts" (drafts are always on).
  const isEmail = isEmailApp(account.app);
  const copy: Record<PermissionKey, PermissionCopy> = {
    write: {
      icon: <SquarePen className={rowIcon} />,
      title: t("connections.permissions.write.title"),
      on: t("connections.permissions.write.on"),
      off: isEmail
        ? t("connections.permissions.write.offEmail")
        : t("connections.permissions.write.off"),
      confirmTitle: t("connections.permissions.write.confirmTitle", { account: name }),
      confirmBody: t("connections.permissions.write.confirmBody", { account: name }),
      confirmCta: t("connections.permissions.write.confirmCta"),
    },
    send: {
      icon: <SendHorizontal className={rowIcon} />,
      title: t("connections.permissions.send.title"),
      on: t("connections.permissions.send.on"),
      off: isEmail
        ? t("connections.permissions.send.offEmail")
        : t("connections.permissions.send.off"),
      confirmTitle: t("connections.permissions.send.confirmTitle", { account: name }),
      confirmBody: t("connections.permissions.send.confirmBody", { account: name }),
      confirmCta: t("connections.permissions.send.confirmCta"),
    },
    delete: {
      icon: <Trash2 className={rowIcon} />,
      title: t("connections.permissions.delete.title"),
      on: t("connections.permissions.delete.on"),
      off: t("connections.permissions.delete.off"),
      confirmTitle: t("connections.permissions.delete.confirmTitle", { account: name }),
      confirmBody: t("connections.permissions.delete.confirmBody", { account: name }),
      confirmCta: t("connections.permissions.delete.confirmCta"),
    },
  };

  const persist = async (key: PermissionKey, value: boolean) => {
    setSaving(true);
    try {
      await onPersist({ ...granted, [key]: value });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const confirmArm = async () => {
    if (!confirmKey) return;
    setConfirmBusy(true);
    try {
      await persist(confirmKey, true);
      setConfirmKey(null);
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <div className="surface flex flex-col gap-1 rounded-lg p-3">
      <p className="px-2 pb-1.5 text-xs text-muted-foreground">
        {isEmail ? t("connections.permissions.hintEmail") : t("connections.permissions.hint")}
      </p>
      {PERMISSION_KEYS.map((key) => (
        <ArmedSwitchRow
          key={key}
          bare
          switchId={`permission-${key}-${account.id}`}
          icon={copy[key].icon}
          title={copy[key].title}
          armed={granted[key]}
          statusOn={copy[key].on}
          statusOff={copy[key].off}
          disabled={saving}
          onToggle={(next) => (next ? setConfirmKey(key) : void persist(key, false))}
        />
      ))}
      <ConfirmDialog
        open={confirmKey !== null}
        onOpenChange={(next) => !confirmBusy && !next && setConfirmKey(null)}
        title={confirmKey ? copy[confirmKey].confirmTitle : ""}
        description={confirmKey ? copy[confirmKey].confirmBody : ""}
        confirmLabel={confirmKey ? copy[confirmKey].confirmCta : ""}
        busy={confirmBusy}
        onConfirm={() => void confirmArm()}
      />
    </div>
  );
}
