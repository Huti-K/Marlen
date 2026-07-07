import * as React from "react";
import {
  Check,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LibraryDocument, LibraryStatus, MemoryEntry } from "@trailin/shared";
import { formatFileSize } from "@trailin/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

/**
 * Knowledge page: long-term memory and the document library — everything
 * that grounds the agent, in one place.
 */
export function KnowledgePanel() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-10 pt-4">
      <Section
        index={0}
        title={t("knowledge.sections.memory.title")}
        description={t("knowledge.sections.memory.description")}
      >
        <MemorySection />
      </Section>

      <Section
        index={1}
        title={t("knowledge.sections.library.title")}
        description={t("knowledge.sections.library.description")}
      >
        <LibrarySection />
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
  index = 0,
  layout = "stack",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  index?: number;
  layout?: "stack" | "row";
}) {
  const header = (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );

  return (
    <section
      className="animate-in-up flex flex-col gap-4"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      {layout === "row" ? (
        <div className="flex items-center justify-between gap-4">
          {header}
          {children}
        </div>
      ) : (
        <>
          {header}
          {children}
        </>
      )}
    </section>
  );
}

/* ---------------- Memory ---------------- */

export function MemorySection() {
  const { t } = useTranslation();
  const [memories, setMemories] = React.useState<MemoryEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      setMemories(await api.memories());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async () => {
    const content = draft.trim();
    if (!content || adding) return;
    setAdding(true);
    try {
      await api.addMemory(content);
      setDraft("");
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter only — this row has no blur-to-save, a stray click mustn't submit it.
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          placeholder={t("memory.addPlaceholder")}
          disabled={adding}
        />
        {adding && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
      </div>

      {loading ? (
        <LoadingRow />
      ) : memories.length > 0 ? (
        <div className="flex flex-col gap-2">
          {memories.map((entry) => (
            <MemoryRow key={entry.id} entry={entry} onChanged={refresh} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MemoryRow({
  entry,
  onChanged,
}: {
  entry: MemoryEntry;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(entry.content);
  const [saving, setSaving] = React.useState(false);
  const busy = React.useRef(false);

  const startEdit = () => {
    setValue(entry.content);
    setEditing(true);
  };

  // Auto-save on Enter or blur — no Save button. The ref guards against Enter
  // and the follow-up blur both firing a save.
  const commit = async () => {
    if (busy.current) return;
    const trimmed = value.trim();
    if (!trimmed || trimmed === entry.content) {
      setValue(entry.content);
      setEditing(false);
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await api.updateMemory(entry.id, trimmed);
      setEditing(false);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
      busy.current = false;
    }
  };

  const cancel = () => {
    setValue(entry.content);
    setEditing(false);
  };

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const remove = async () => {
    setDeleting(true);
    try {
      await api.deleteMemory(entry.id);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
      setDeleting(false);
    } finally {
      setConfirmOpen(false);
    }
  };

  return (
    <div className="flex items-start justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-2.5">
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void commit();
                }
                if (e.key === "Escape") cancel();
              }}
              disabled={saving}
              className="h-8 px-2.5 py-1 text-sm"
            />
            {saving && (
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.saving")}
              </span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="block w-full text-pretty text-left text-sm leading-relaxed"
          >
            {entry.content}
          </button>
        )}
        {!editing && entry.source === "agent" && (
          <Badge variant="muted" className="mt-1.5 text-[11px]">
            {t("memory.savedByAgent")}
          </Badge>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirmOpen(true)}
        title={t("memory.delete")}
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("memory.delete")}
        description={t("memory.deleteConfirm")}
        confirmLabel={t("memory.delete")}
        variant="destructive"
        busy={deleting}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/* ---------------- Library ---------------- */

export function LibrarySection() {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<LibraryStatus | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const refresh = React.useCallback(async () => {
    try {
      setStatus(await api.library());
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // Files can be dropped into the folder outside the app — catch up when the
  // tab regains focus (matches App.tsx's status refresh).
  React.useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const upload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setUploading(true);
    let last: LibraryStatus | null = null;
    // Sequential on purpose: mirrors the server, which indexes one file at a
    // time so a batch drop never spikes the CPU under a running chat.
    for (const file of Array.from(fileList)) {
      try {
        last = await api.uploadLibraryFile(file);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
    if (last) setStatus(last);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const [docToDelete, setDocToDelete] = React.useState<LibraryDocument | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const confirmRemove = async () => {
    if (!docToDelete) return;
    setDeleting(true);
    try {
      setStatus(await api.deleteLibraryDocument(docToDelete.id));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
      setDocToDelete(null);
    }
  };

  if (!status) {
    return loadError ? (
      <div className="flex flex-col items-start gap-2">
        <ErrorBanner>{loadError}</ErrorBanner>
        <Button variant="ghost" size="sm" onClick={() => void refresh()}>
          {t("common.retry")}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="flex flex-col gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <LibraryFolderControl folder={status.folder} onStatus={setStatus} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".pdf,.md,.markdown,.txt,.docx,.csv,.html,.htm"
              className="hidden"
              onChange={(e) => void upload(e.target.files)}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
              {t("library.upload")}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("library.folderHint")}</p>
      </div>

      {status.documents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-surface-2 py-12 text-center">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface text-accent">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">{t("library.emptyTitle")}</p>
            <p className="max-w-xs text-pretty text-xs text-muted-foreground">
              {t("library.emptyBody")}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {status.documents.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} onDelete={() => setDocToDelete(doc)} />
          ))}
        </div>
      )}
      <ConfirmDialog
        open={!!docToDelete}
        onOpenChange={(open) => !open && setDocToDelete(null)}
        title={t("library.delete")}
        description={docToDelete ? t("library.deleteConfirm", { title: docToDelete.title }) : ""}
        confirmLabel={t("library.delete")}
        variant="destructive"
        busy={deleting}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}

/**
 * Two-state drop-folder control. Display state shows the path, truncated so
 * the end stays visible; "Change folder" opens the OS's native folder dialog
 * via the server (the request stays open while the dialog is on screen).
 * Clicking the path itself — or a failed pick (headless/remote setups) —
 * switches to the inline editable state: Enter or a changed blur saves,
 * Escape or an unchanged blur reverts. The server re-indexes the new folder.
 */
function LibraryFolderControl({
  folder,
  onStatus,
}: {
  folder: string;
  onStatus: (status: LibraryStatus) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<"display" | "edit">("display");
  const [draft, setDraft] = React.useState(folder);
  const [state, setState] = React.useState<"idle" | "saving" | "saved">("idle");
  const [picking, setPicking] = React.useState(false);
  const busy = React.useRef(false);

  // Follow the active folder (initial load, refreshes, saves from this row).
  React.useEffect(() => setDraft(folder), [folder]);

  const startEdit = () => {
    setDraft(folder);
    setState("idle");
    setMode("edit");
  };

  const pick = async () => {
    if (busy.current) return;
    busy.current = true;
    setPicking(true);
    try {
      const next = await api.pickLibraryFolder();
      // Dialog dismissed — nothing changed, nothing to say.
      if ("canceled" in next) return;
      onStatus(next);
      setDraft(next.folder);
      setState("saved");
      setTimeout(() => setState("idle"), 500);
    } catch (err) {
      toast.error(errorMessage(err));
      // No native dialog (headless/remote server) or the pick was rejected —
      // fall back to typing/pasting the path inline.
      startEdit();
    } finally {
      setPicking(false);
      busy.current = false;
    }
  };

  const revert = () => {
    setDraft(folder);
    setState("idle");
    setMode("display");
  };

  // Auto-save on Enter or blur — no Save button. The ref guards against Enter
  // and the follow-up blur both firing a save.
  const commit = async () => {
    if (busy.current) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === folder) {
      revert();
      return;
    }
    busy.current = true;
    setState("saving");
    try {
      // The server validates, switches over and re-indexes; the returned
      // status already lists the new folder's documents.
      const next = await api.setLibraryFolder(trimmed);
      onStatus(next);
      setDraft(next.folder);
      setState("saved");
      // The save itself already took a beat (the server re-indexes the new
      // folder before responding) — a short flash is enough to register.
      setTimeout(() => {
        setMode("display");
        setState("idle");
      }, 500);
    } catch (err) {
      toast.error(errorMessage(err));
      setState("idle");
      // Stay in edit state so the user can correct the path.
    } finally {
      busy.current = false;
    }
  };

  if (mode === "display") {
    return (
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <button
          type="button"
          dir="rtl"
          onClick={startEdit}
          disabled={picking}
          title={folder}
          aria-label={t("library.editPath")}
          className="min-w-0 flex-1 cursor-text truncate text-left font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {folder}
        </button>
        {state === "saved" && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success" /> {t("common.saved")}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={() => void pick()}
          disabled={picking}
        >
          {picking && <Loader2 className="animate-spin" />}
          {t("library.changeFolder")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setState((s) => (s === "saving" ? s : "idle"));
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            revert();
          }
        }}
        aria-label={t("library.folderLabel")}
        className="font-mono text-xs"
        disabled={state === "saving"}
      />
      {state === "saving" ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.saving")}
        </span>
      ) : state === "saved" ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-success" /> {t("common.saved")}
        </span>
      ) : null}
    </div>
  );
}

/** Lucide icon for a document's format — grouped by how the file is used, not exact type. */
function iconForExt(ext: string) {
  switch (ext.toLowerCase()) {
    case "pdf":
    case "md":
    case "markdown":
    case "txt":
      return FileText;
    case "csv":
      return FileSpreadsheet;
    case "html":
    case "htm":
      return FileCode2;
    default:
      return File;
  }
}

function DocumentRow({ doc, onDelete }: { doc: LibraryDocument; onDelete: () => void }) {
  const { t } = useTranslation();
  const Icon = iconForExt(doc.ext);
  return (
    <div className="group flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</p>
            <Badge variant="muted" className="shrink-0 text-[11px]">
              {doc.ext.toUpperCase()}
            </Badge>
          </div>
          {doc.status === "error" ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <Badge variant="destructive" className="shrink-0 text-[11px]">
                {t("library.error")}
              </Badge>
              <span
                title={doc.error ?? undefined}
                className="min-w-0 truncate text-xs text-muted-foreground"
              >
                {doc.error}
              </span>
            </div>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              {formatFileSize(doc.size)} · {t("library.sectionCount", { count: doc.chunkCount })}
            </p>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        title={t("library.delete")}
        className="shrink-0 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}
