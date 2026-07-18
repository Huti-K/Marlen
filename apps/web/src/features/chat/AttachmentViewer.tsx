import { ExternalLink, FolderDown } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
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
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) setItem(null);
      }}
      title={item?.filename ?? ""}
      className="h-[85vh] max-w-5xl gap-3 p-4"
      bodyClassName="min-h-0 flex-1 overflow-hidden"
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => url && openExternal(url)}>
            <ExternalLink className="h-3.5 w-3.5" />
            {t("chat.attachmentViewer.openInBrowser")}
          </Button>
          {item?.saveable && (
            <Button variant="secondary" size="sm" onClick={save} loading={saving}>
              <FolderDown className="h-3.5 w-3.5" />
              {t("chat.attachmentViewer.save")}
            </Button>
          )}
        </>
      }
    >
      <div className="min-h-0 flex-1 overflow-hidden rounded-[--radius] bg-surface-2">
        {item && <AttachmentBody url={url} filename={item.filename} />}
      </div>
    </Dialog>
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
