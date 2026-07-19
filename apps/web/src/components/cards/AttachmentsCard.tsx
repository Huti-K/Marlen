import { type AgentCard, type AttachmentItem, formatFileSize } from "@trailin/shared";
import type { LucideIcon } from "lucide-react";
import { Download, Eye, FileText, ImageIcon, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openAttachment } from "@/features/chat/controller";
import { api } from "@/lib/api";
import { openExternal } from "@/lib/utils";
import { CardShell } from "./CardShell";

type AttachmentsData = Extract<AgentCard, { kind: "attachments" }>;

/** Row glyph by kind — images, PDFs/text, anything else. */
function iconFor(item: AttachmentItem): LucideIcon {
  const mime = item.mimeType ?? "";
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(item.filename)) {
    return ImageIcon;
  }
  return FileText;
}

/**
 * A message's attachments as actionable rows: viewable files (PDF, images,
 * plain text) open in the side-panel viewer; the rest download. Save-to-library
 * lives inside the viewer, so the row's single action is open-or-download.
 */
export function AttachmentsCard({ card, color }: { card: AttachmentsData; color?: string }) {
  const { t } = useTranslation();
  const { account, subject, items } = card;

  const open = (item: AttachmentItem) => {
    if (item.viewable) {
      openAttachment({
        accountId: item.accountId,
        messageId: item.messageId,
        filename: item.filename,
        ...(item.mimeType ? { mimeType: item.mimeType } : {}),
        saveable: item.saveable,
      });
    } else {
      openExternal(api.mailAttachmentUrl(item.accountId, item.messageId, item.filename));
    }
  };

  return (
    <CardShell
      icon={Paperclip}
      label={t("chat.cards.attachments.title")}
      meta={t("chat.cards.attachments.count", { count: items.length })}
      title={subject || undefined}
      account={account}
      color={color}
    >
      {items.length === 0 ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {t("chat.cards.attachments.empty")}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5 px-4 pb-4 pt-1">
          {items.map((item) => {
            const Icon = iconFor(item);
            return (
              <div
                key={`${item.messageId}:${item.filename}`}
                className="flex min-w-0 items-center gap-2.5"
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.filename}</p>
                  {item.size !== undefined && (
                    <p className="font-mono text-2xs tabular-nums text-muted-foreground">
                      {formatFileSize(item.size)}
                    </p>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  onClick={() => open(item)}
                >
                  {item.viewable ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  {item.viewable
                    ? t("chat.cards.attachments.open")
                    : t("chat.cards.attachments.download")}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </CardShell>
  );
}
