import * as React from "react";
import { Check, Copy, FileText, FolderOpen, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LibraryDocument, LibraryStatus, MemoryEntry } from "@trailin/shared";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { toast } from "@/lib/toast";
import { cn, errorMessage } from "@/lib/utils";

/**
 * Knowledge page: standing instructions, long-term memory and the document
 * library — everything that grounds and steers the agent, in one place.
 */
export function KnowledgePanel() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-10 pt-4">
      <Section
        index={0}
        title={t("knowledge.sections.instructions.title")}
        description={t("knowledge.sections.instructions.description")}
      >
        <InstructionsSection />
      </Section>

      <Section
        index={1}
        title={t("knowledge.sections.memory.title")}
        description={t("knowledge.sections.memory.description")}
      >
        <MemorySection />
      </Section>

      <Section
        index={2}
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

/* ---------------- Agent instructions ---------------- */

function InstructionsSection() {
  const { t } = useTranslation();
  // null until the initial GET resolves.
  const [value, setValue] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState("");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);
  const busy = React.useRef(false);

  React.useEffect(() => {
    api
      .instructions()
      .then(({ instructions }) => {
        setValue(instructions);
        setSaved(instructions);
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, []);

  // Auto-save on blur or Cmd/Ctrl+Enter — no Save button. The ref guards
  // against both firing a save for the same change.
  const persist = async () => {
    if (busy.current || value === null) return;
    const trimmed = value.trim();
    if (trimmed === saved) return;
    busy.current = true;
    setState("saving");
    setError(null);
    try {
      const next = await api.setInstructions(trimmed);
      setValue(next.instructions);
      setSaved(next.instructions);
      setState("saved");
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    } finally {
      busy.current = false;
    }
  };

  if (value === null) {
    return loadError ? <ErrorBanner>{loadError}</ErrorBanner> : <LoadingRow />;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          // A fresh edit invalidates the last "saved"/"error" readout, but
          // leave an in-flight save's spinner alone.
          setState((s) => (s === "saving" ? s : "idle"));
        }}
        onBlur={() => void persist()}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void persist();
          }
        }}
        placeholder={t("knowledge.sections.instructions.placeholder")}
        rows={5}
      />
      <div className="flex h-4 items-center justify-end gap-1.5 text-xs text-muted-foreground">
        {state === "saving" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.saving")}
          </>
        ) : state === "error" ? (
          <span className="text-destructive">{error}</span>
        ) : state === "saved" ? (
          <>
            <Check className="h-3.5 w-3.5 text-success" /> {t("common.saved")}
          </>
        ) : null}
      </div>
    </div>
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
      ) : memories.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("memory.empty")}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {memories.map((entry) => (
            <MemoryRow key={entry.id} entry={entry} onChanged={refresh} />
          ))}
        </div>
      )}
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

  const remove = async () => {
    if (!window.confirm(t("memory.deleteConfirm"))) return;
    try {
      await api.deleteMemory(entry.id);
      await onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
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
        onClick={() => void remove()}
        title={t("memory.delete")}
      >
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

/* ---------------- Library ---------------- */

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LibrarySection() {
  const { t } = useTranslation();
  const [status, setStatus] = React.useState<LibraryStatus | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
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

  const copyFolder = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.folder);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const rescan = async () => {
    setScanning(true);
    try {
      setStatus(await api.libraryScan());
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setScanning(false);
    }
  };

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

  const remove = async (doc: LibraryDocument) => {
    if (!window.confirm(t("library.deleteConfirm", { title: doc.title }))) return;
    try {
      setStatus(await api.deleteLibraryDocument(doc.id));
    } catch (err) {
      toast.error(errorMessage(err));
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
        <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3.5 py-2.5">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {status.folder}
          </code>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void copyFolder()}
            title={t("library.copyFolder")}
          >
            {copied ? (
              <Check className="h-4 w-4 text-success" />
            ) : (
              <Copy className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("library.folderHint")}</p>
      </div>

      <div className="flex items-center justify-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.md,.markdown,.txt"
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
        />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void rescan()}
          disabled={scanning}
          title={t("library.rescan")}
        >
          <RefreshCw className={cn("h-4 w-4 text-muted-foreground", scanning && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />}
          {t("library.upload")}
        </Button>
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
            <DocumentRow key={doc.id} doc={doc} onDelete={() => void remove(doc)} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentRow({ doc, onDelete }: { doc: LibraryDocument; onDelete: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{doc.title}</p>
          {doc.status === "error" ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
              <Badge variant="destructive" className="shrink-0 text-[11px]">
                {t("library.error")}
              </Badge>
              <span className="min-w-0 truncate text-xs text-muted-foreground">{doc.error}</span>
            </div>
          ) : (
            <p className="truncate text-xs text-muted-foreground">
              {doc.ext.toUpperCase()} · {formatBytes(doc.size)} ·{" "}
              {t("library.sectionCount", { count: doc.chunkCount })}
            </p>
          )}
        </div>
      </div>
      <Button variant="ghost" size="icon" onClick={onDelete} title={t("library.delete")}>
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}
