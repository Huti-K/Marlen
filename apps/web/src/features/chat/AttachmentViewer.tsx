import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ExternalLink, FolderDown, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { subscribeTrailin, type TrailinEventMap } from "@/lib/trailinEvents";
import { openExternal } from "@/lib/utils";

type OpenAttachment = TrailinEventMap["open-attachment"];

/** How the bytes render inline, derived from the filename (matches the server's by-extension MIME). */
function renderKind(filename: string): "pdf" | "image" | "text" {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"].includes(ext)) return "image";
  return "text";
}

/**
 * The centered email-attachment viewer. A single instance is mounted at the
 * app shell; it opens on the `open-attachment` event any attachments card
 * fires, streams the bytes from GET /api/mail/attachments/open, and renders
 * them inline (PDF, image, or plain text) without ever saving. Its actions:
 * open the same bytes in a browser tab, and — for library formats — the
 * explicit "Save to library" write.
 *
 * A modal dialog per DESIGN.md: the `.scrim` backdrop separates it, the panel
 * is a plain `surface` (no border, no shadow) centered on the canvas, and the
 * document sits in a recessed `surface-2` frame.
 */
export function AttachmentViewer() {
  const { t } = useTranslation();
  const [item, setItem] = React.useState<OpenAttachment | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(
    () =>
      subscribeTrailin("open-attachment", (detail) => {
        setSaving(false);
        setItem(detail);
      }),
    [],
  );

  const url = item ? api.mailAttachmentUrl(item.accountId, item.messageId, item.filename) : "";

  const save = async () => {
    if (!item) return;
    setSaving(true);
    try {
      await api.saveMailAttachment(item.accountId, item.messageId, item.filename);
      toast.success(t("chat.attachmentViewer.saved", { name: item.filename }));
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogPrimitive.Root
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) setItem(null);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="scrim fixed inset-0 z-[110]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="surface fixed left-1/2 top-1/2 z-[120] flex h-[85vh] w-[calc(100%-2.5rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <DialogPrimitive.Title className="min-w-0 truncate text-sm font-semibold tracking-tight">
              {item?.filename}
            </DialogPrimitive.Title>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => url && openExternal(url)}>
                <ExternalLink className="h-3.5 w-3.5" />
                {t("chat.attachmentViewer.openInBrowser")}
              </Button>
              {item?.saveable && (
                <Button variant="secondary" size="sm" onClick={save} disabled={saving}>
                  <FolderDown className="h-3.5 w-3.5" />
                  {t("chat.attachmentViewer.save")}
                </Button>
              )}
              <DialogPrimitive.Close asChild>
                <IconButton aria-label={t("common.close")}>
                  <X className="h-4 w-4" />
                </IconButton>
              </DialogPrimitive.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-[--radius] bg-surface-2">
            {item && <AttachmentBody url={url} filename={item.filename} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** The inline render of the streamed bytes, by kind. Text renders in a scripts-off iframe. */
function AttachmentBody({ url, filename }: { url: string; filename: string }) {
  switch (renderKind(filename)) {
    case "pdf":
      return (
        <object data={url} type="application/pdf" title={filename} className="h-full w-full" />
      );
    case "image":
      return (
        <div className="flex h-full w-full items-center justify-center p-3">
          <img src={url} alt={filename} className="max-h-full max-w-full object-contain" />
        </div>
      );
    default:
      return <iframe src={url} title={filename} sandbox="" className="h-full w-full bg-surface" />;
  }
}
