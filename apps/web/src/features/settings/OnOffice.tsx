import type { OnOfficeStatus } from "@trailin/shared";
import { Building2, Check, ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { ListRow } from "@/components/ui/list-row";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { openExternal } from "@/lib/utils";

/**
 * onOffice CRM connection — a native (non-Pipedream) integration authenticated
 * with an API user's token + secret. It lives alongside the Pipedream accounts
 * in Settings → Email: an entry in the "add account" picker opens the token
 * form, and once configured it shows as a connected row in the accounts list.
 */

/** Fetch and refresh the onOffice credential status. A failed fetch leaves status null (the entry just hides). */
export function useOnOfficeStatus(): {
  status: OnOfficeStatus | null;
  refresh: () => Promise<void>;
} {
  const [status, setStatus] = React.useState<OnOfficeStatus | null>(null);
  const refresh = React.useCallback(async () => {
    try {
      setStatus(await api.onOfficeStatus());
    } catch {
      // Best-effort: a failed status just keeps onOffice out of the picker.
    }
  }, []);
  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}

/** The onOffice row in the "add account" picker — mirrors PickerRow, branded with a CRM glyph. */
export function OnOfficePickerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-left transition-colors hover:bg-secondary"
    >
      <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">onOffice</span>
      <Plus className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

/** Connected onOffice row in the accounts list, with edit + disconnect (only when app-saved). */
export function OnOfficeAccountRow({
  status,
  onEdit,
  onDisconnected,
}: {
  status: OnOfficeStatus;
  onEdit: () => void;
  onDisconnected: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const editable = status.source === "settings";

  const disconnect = async () => {
    setRemoving(true);
    try {
      await api.clearOnOffice();
      await onDisconnected();
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
      setConfirm(false);
    }
  };

  return (
    <ListRow className="relative">
      <div className="flex min-w-0 items-center gap-3">
        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">onOffice</p>
          <p className="text-xs text-muted-foreground">{t("onoffice.crmLabel")}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="success">{t("connections.healthy")}</Badge>
        {editable && (
          <Button variant="ghost" size="icon-sm" onClick={onEdit} title={t("onoffice.edit")}>
            <Pencil />
          </Button>
        )}
        {editable && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setConfirm(true)}
            title={t("onoffice.removeSaved")}
          >
            <Trash2 />
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("onoffice.removeSaved")}
        description={t("onoffice.removeSavedConfirm")}
        confirmLabel={t("onoffice.removeSaved")}
        busy={removing}
        onConfirm={() => void disconnect()}
      />
    </ListRow>
  );
}

/**
 * The token + secret form. onOffice credentials are a pair that only work
 * together, so they save through one form (like the Pipedream credentials)
 * rather than field-by-field on blur.
 */
export function OnOfficeForm({
  status,
  onSaved,
  onClose,
}: {
  status: OnOfficeStatus;
  onSaved: () => Promise<void>;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [token, setToken] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  // A saved-in-app credential can be kept by leaving its field empty.
  const canKeep = status.source === "settings";
  const canSave = Boolean((token.trim() || canKeep) && (secret.trim() || canKeep));

  const save = async () => {
    setBusy(true);
    try {
      await api.saveOnOffice({
        token: token.trim() || undefined,
        secret: secret.trim() || undefined,
      });
      await onSaved();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="md" className="animate-in-up flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t("onoffice.setupTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("onoffice.setupIntro")}</p>
        </div>
        {onClose && (
          <IconButton onClick={onClose} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </IconButton>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => openExternal("https://apidoc.onoffice.de/")}
      >
        <ExternalLink /> {t("onoffice.openApiDocs")}
      </Button>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="oo-token" label={t("onoffice.token")}>
          <Input
            id="oo-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={canKeep ? t("onoffice.keepPlaceholder") : ""}
            className="font-mono"
            autoComplete="off"
          />
        </FormField>
        <FormField id="oo-secret" label={t("onoffice.secret")}>
          <Input
            id="oo-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder={canKeep ? t("onoffice.keepPlaceholder") : ""}
            className="font-mono"
            autoComplete="off"
          />
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button size="sm" onClick={() => void save()} disabled={!canSave || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Check />}
          {t("onoffice.save")}
        </Button>
      </div>
    </Card>
  );
}
