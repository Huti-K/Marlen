import type { LibraryDocument } from "@trailin/shared";
import { formatFileSize } from "@trailin/shared";
import { ExternalLink, File, FileCode2, FileSpreadsheet, FileText, Trash2 } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HoverActions } from "@/components/ui/hover-actions";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/**
 * One document tile in the library grid, plus the file-type glyph/hue
 * vocabulary it renders with.
 *
 * Shape carries the file type; color is reserved for status. index.css calls
 * the `tint-*` fills "status tints", and an extension is not a status — so a
 * PDF gets a page glyph rather than a red one, and only a failed extraction
 * earns a colored tile.
 */
function fileTypeIcon(ext: string): typeof File {
  switch (ext.toLowerCase()) {
    case "pdf":
    case "docx":
    case "txt":
      return FileText;
    case "md":
    case "markdown":
    case "html":
    case "htm":
      return FileCode2;
    case "csv":
      return FileSpreadsheet;
    default:
      return File;
  }
}

/** Formats that mean the same thing should wear the same colour. */
const EXT_ALIAS: Record<string, string> = { markdown: "md", htm: "html" };

/**
 * The formats the library indexes get the hues people already expect — red PDF,
 * green spreadsheet, blue document. Everything else derives a hue from its own
 * characters, so an unknown extension picks a colour once and keeps it forever
 * without anyone maintaining a table.
 */
const EXT_HUE: Record<string, number> = {
  pdf: 27,
  html: 70,
  csv: 155,
  txt: 195,
  docx: 250,
  md: 315,
};

function extHue(ext: string): number {
  const key = EXT_ALIAS[ext.toLowerCase()] ?? ext.toLowerCase();
  const known = EXT_HUE[key];
  if (known !== undefined) return known;
  // djb2, snapped to 24 steps so no two formats land a few degrees apart.
  let hash = 5381;
  for (let i = 0; i < key.length; i++) hash = (hash * 33 + key.charCodeAt(i)) >>> 0;
  return (hash % 24) * 15;
}

/** Feeds `.tint-file` (index.css) the one value it needs. */
const hueStyle = (ext: string) => ({ "--filetype-h": String(extHue(ext)) }) as React.CSSProperties;

/**
 * A folder-style tile: colour block on top, name and metadata beneath. No fill
 * at rest — the thumbnail carries the weight, and the tile only takes a fill
 * under the cursor, so a wall of these reads as files rather than as cards.
 */
export function DocumentTile({
  doc,
  snippet,
  onDelete,
  highlighted,
}: {
  doc: LibraryDocument;
  snippet?: string;
  onDelete: () => void;
  /** True when opened via the search palette — draws attention with a soft accent fill. */
  highlighted?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const Icon = fileTypeIcon(doc.ext);
  const failed = doc.status === "error";
  const canOpen = !failed;

  return (
    <div
      data-doc-id={doc.id}
      className={cn(
        "group relative flex flex-col rounded-lg p-1.5 transition-colors hover:bg-surface-2",
        highlighted && "bg-accent/10",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex min-w-0 flex-col gap-1.5 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          canOpen ? "cursor-pointer" : "cursor-default",
        )}
        onClick={() => canOpen && api.openLibraryDocument(doc.id)}
        // Not aria-label: that would replace the title as the accessible name.
        data-tooltip={canOpen ? t("library.openDocument") : undefined}
      >
        <span
          className={cn(
            "grid aspect-[4/3] w-full place-items-center rounded-md transition-transform",
            failed ? "tint-danger" : "tint-file",
            canOpen && "group-hover:scale-[1.02]",
          )}
          style={failed ? undefined : hueStyle(doc.ext)}
        >
          <Icon className="h-6 w-6" />
        </span>

        <span className="flex min-w-0 flex-col gap-0.5 px-0.5 pb-0.5">
          <span
            className={cn(
              "truncate text-[13px] font-medium leading-snug",
              canOpen && "group-hover:text-accent",
            )}
          >
            {doc.title}
          </span>

          {failed ? (
            // The tile has no room for the reason — keep it a hover away.
            <Badge
              variant="destructive"
              className="h-4 self-start px-1 py-0 text-3xs"
              data-tooltip={doc.error ?? undefined}
            >
              {t("library.error")}
            </Badge>
          ) : (
            <span className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
              <span
                className="tint-file shrink-0 rounded px-1 py-0.5 font-mono text-3xs uppercase leading-none"
                style={hueStyle(doc.ext)}
              >
                {doc.ext}
              </span>
              <time
                dateTime={doc.modifiedAt}
                className="min-w-0 truncate"
                data-tooltip={`${new Date(doc.modifiedAt).toLocaleString(i18n.language)} · ${formatFileSize(doc.size)} · ${t("library.sectionCount", { count: doc.chunkCount })}`}
              >
                {relativeTime(doc.modifiedAt, i18n.language)}
              </time>
            </span>
          )}

          {snippet && !failed && (
            <span className="mt-0.5 line-clamp-2 text-2xs leading-snug text-muted-foreground/70">
              {snippet}
            </span>
          )}
        </span>
      </button>

      {/* Float over the thumbnail's corner rather than stealing a column of the tile. */}
      <HoverActions className="absolute right-2 top-2 gap-1">
        {canOpen && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => api.openLibraryDocument(doc.id)}
            aria-label={t("library.openDocument")}
            className="bg-surface"
          >
            <ExternalLink />
          </Button>
        )}
        <Button
          variant="ghost-danger"
          size="icon-xs"
          onClick={onDelete}
          aria-label={t("library.delete")}
          className="bg-surface"
        >
          <Trash2 />
        </Button>
      </HoverActions>
    </div>
  );
}
