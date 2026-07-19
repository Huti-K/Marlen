import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { WhatsAppStatus } from "@trailin/shared";
import { LogOut, MessageCircle, Plus, RefreshCw, Settings, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { OptionRow } from "@/components/ui/option-row";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ArmedToggleRow } from "@/features/connections/AccountPermissions";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

/**
 * The personal WhatsApp link — a native integration over the WhatsApp Web
 * protocol, paired by scanning a QR code with the phone. It lives alongside
 * the Pipedream accounts in Settings → Accounts: a picker entry opens the
 * pairing card, and once linked it shows as a connected row. Pairing is
 * asynchronous — the QR, the scan and the final open state each arrive as a
 * "whatsapp" server event, so the status here stays live.
 */

const rowIcon = <MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />;

/** Fetch the WhatsApp link status and keep it live via the "whatsapp" event topic. */
export function useWhatsAppStatus(): {
  status: WhatsAppStatus | null;
  refresh: () => Promise<void>;
} {
  const queryClient = useQueryClient();
  // Best-effort: a failed status just keeps WhatsApp out of the picker.
  const { data: status } = useQuery({
    queryKey: ["whatsapp", "status"],
    queryFn: () => api.whatsAppStatus().catch(() => null),
  });
  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["whatsapp"] });
  }, [queryClient]);
  return { status: status ?? null, refresh };
}

/** The WhatsApp row in the "add account" picker. */
export function WhatsAppPickerButton({ onClick }: { onClick: () => void }) {
  return (
    <OptionRow
      fill="recessed"
      onClick={onClick}
      icon={<MessageCircle className="h-5 w-5 shrink-0 text-muted-foreground" />}
      label="WhatsApp"
      trailing={
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      }
    />
  );
}

/**
 * The pairing card: opens the pairing socket on mount and shows the QR as
 * soon as the server has one. Status changes stream in via useWhatsAppStatus
 * in the parent; when the connection opens this card reports done.
 */
export function WhatsAppPairingCard({
  status,
  onPaired,
  onClose,
}: {
  status: WhatsAppStatus;
  onPaired: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [restarting, setRestarting] = React.useState(false);

  const connect = React.useCallback(async () => {
    try {
      await api.whatsAppConnect();
    } catch (err) {
      toast.error(err);
    }
  }, []);

  React.useEffect(() => {
    void connect();
  }, [connect]);

  const paired = status.connection === "open" || (status.linked && status.connection !== "pairing");
  React.useEffect(() => {
    if (paired) void onPaired();
  }, [paired, onPaired]);

  // The server drops back to "off" when the QR expires unscanned.
  const expired = !status.linked && status.connection === "off";

  const restart = async () => {
    setRestarting(true);
    await connect();
    setRestarting(false);
  };

  return (
    <Card padding="md" className="animate-in-up flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">{t("whatsapp.pairTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("whatsapp.pairIntro")}</p>
        </div>
        <IconButton onClick={onClose} aria-label={t("common.close")}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="flex flex-col items-center gap-3 py-2">
        {expired ? (
          <>
            <p className="text-xs text-muted-foreground">{t("whatsapp.pairExpired")}</p>
            <Button size="sm" onClick={() => void restart()} loading={restarting}>
              <RefreshCw />
              {t("whatsapp.pairRetry")}
            </Button>
          </>
        ) : status.qrDataUrl ? (
          <>
            {/* The QR is white-on-white by nature; the recessed fill frames it. */}
            <img
              src={status.qrDataUrl}
              alt={t("whatsapp.pairQrAlt")}
              className="h-52 w-52 rounded-lg bg-surface-2 p-2"
            />
            <p className="text-2xs text-muted-foreground">{t("whatsapp.pairQrHint")}</p>
          </>
        ) : (
          <>
            <Skeleton className="h-52 w-52 rounded-lg" />
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner className="h-3 w-3" />
              {t("whatsapp.pairGenerating")}
            </p>
          </>
        )}
      </div>
    </Card>
  );
}

/** Connection state chip on the connected row. */
function ConnectionBadge({ status }: { status: WhatsAppStatus }) {
  const { t } = useTranslation();
  if (status.connection === "open") {
    return <Badge variant="success">{t("whatsapp.statusConnected")}</Badge>;
  }
  if (status.connection === "connecting") {
    return (
      <Badge variant="muted">
        <Spinner className="h-3 w-3" />
        {t("whatsapp.statusConnecting")}
      </Badge>
    );
  }
  return <Badge variant="warning">{t("whatsapp.statusOffline")}</Badge>;
}

/** Connected WhatsApp row in the accounts list, with permissions + unlink. */
export function WhatsAppAccountRow({
  status,
  onTogglePermissions,
  onUnlinked,
}: {
  status: WhatsAppStatus;
  onTogglePermissions: () => void;
  onUnlinked: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  const unlink = async () => {
    setRemoving(true);
    try {
      await api.whatsAppUnlink();
      await onUnlinked();
    } catch (err) {
      toast.error(err);
    } finally {
      setRemoving(false);
      setConfirm(false);
    }
  };

  const identity = status.pushName || (status.phoneNumber ? `+${status.phoneNumber}` : "");

  return (
    <ListRow className="relative">
      <div className="flex min-w-0 items-center gap-3">
        {rowIcon}
        <p className="min-w-0 truncate text-sm font-medium">WhatsApp</p>
        {identity && (
          <p className="min-w-0 truncate font-mono text-xs text-muted-foreground">{identity}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ConnectionBadge status={status} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onTogglePermissions}
          aria-label={t("connections.permissions.edit")}
          data-tooltip={t("connections.permissions.edit")}
        >
          <Settings />
        </Button>
        <Button
          variant="ghost-danger"
          size="icon-sm"
          onClick={() => setConfirm(true)}
          aria-label={t("whatsapp.unlink")}
          data-tooltip={t("whatsapp.unlink")}
        >
          <LogOut />
        </Button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("whatsapp.unlink")}
        description={t("whatsapp.unlinkConfirm")}
        confirmLabel={t("whatsapp.unlink")}
        busy={removing}
        onConfirm={() => void unlink()}
      />
    </ListRow>
  );
}

/** The WhatsApp permission editor: the one armable grant — sending. */
export function WhatsAppPermissionsEditor({
  status,
  onChanged,
}: {
  status: WhatsAppStatus;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();

  return (
    <div className="surface flex flex-col gap-1 rounded-lg p-3">
      <ArmedToggleRow
        switchId="whatsapp-send-access"
        icon={rowIcon}
        armed={status.sendAccess}
        persist={(enabled) => api.setWhatsAppSendAccess(enabled)}
        onChanged={onChanged}
        texts={{
          title: t("connections.permissions.whatsappSend.title"),
          rowOn: t("connections.permissions.whatsappSend.rowOn"),
          rowOff: t("connections.permissions.whatsappSend.rowOff"),
          confirmTitle: t("connections.permissions.whatsappSend.confirmTitle"),
          confirmBody: t("connections.permissions.whatsappSend.confirmBody"),
          confirmCta: t("connections.permissions.whatsappSend.confirmCta"),
        }}
      />
    </div>
  );
}
