import { randomUUID } from "node:crypto";
import { type Dirent, type FSWatcher, watch } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type HtmlToTextOptions, htmlToText } from "html-to-text";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { getLibraryFolderSetting, LIBRARY_FOLDER_SETTING_KEY, setSetting } from "../db/settings.js";
import { env } from "../env.js";
import { emitServerEvent } from "../events.js";
import { moduleLogger } from "../logger.js";
import { errorMessage } from "../utils/util.js";
import * as store from "./store.js";

const ingestLog = moduleLogger("library");

/**
 * The library drop folder: files put there (or uploaded via the web UI) are
 * extracted and indexed into SQLite so the agent can search and read them.
 * Everything runs in-process and off the request path — a scan happens on
 * boot, when the folder changes, and on demand.
 */

export const LIBRARY_EXTENSIONS = new Set([
  ".pdf",
  ".md",
  ".markdown",
  ".txt",
  ".docx",
  ".csv",
  ".html",
  ".htm",
]);
/** Human-readable form of LIBRARY_EXTENSIONS, for messages shown to the user. */
export const SUPPORTED_FORMATS = "PDF, Word (.docx), Markdown, text, CSV, HTML";

/** Expand a leading ~ to the home directory and resolve to an absolute path. */
function resolveFolder(input: string): string {
  const expanded =
    input === "~" || input.startsWith("~/") ? join(homedir(), input.slice(1)) : input;
  return resolve(expanded);
}

/**
 * The active drop folder. startLibrary() replaces this env default with the
 * saved setting, and setLibraryFolder() re-points it at runtime — read it
 * through getLibraryDir(), never at module load.
 */
let libraryDir = resolveFolder(env.libraryPath);

export function getLibraryDir(): string {
  return libraryDir;
}

/**
 * Resolve a document's stored relative path against the library folder.
 * Returns the absolute path, or null when the result would escape the folder
 * — a DB row must never point file access (read or delete) outside the
 * library, however its path came to contain traversal segments.
 */
export function resolveLibraryPath(dir: string, relPath: string): string | null {
  const absPath = resolve(dir, relPath);
  return absPath.startsWith(dir + sep) ? absPath : null;
}

/** Documents are stored whole; this only guards against pathological files. */
const MAX_TEXT_LENGTH = 2_000_000;
const CHUNK_TARGET = 1800;
/** Files larger than this are listed as errors rather than read into memory. */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** A file modified this recently may still be mid-copy; give it a settle check. */
const QUIESCENCE_RECENT_MS = 5000;
const QUIESCENCE_WAIT_MS = 500;
const QUIESCENCE_RESCAN_MS = 2000;

/** html-to-text options for .html/.htm files: headings stay as written
 * (uppercased by default), links keep their URLs so they stay searchable. */
const HTML_EXTRACT_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  selectors: ["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
    selector,
    options: { uppercase: false },
  })),
};

async function extractText(absPath: string, ext: string): Promise<string> {
  if (ext === ".pdf") {
    const parser = new PDFParse({ data: new Uint8Array(await readFile(absPath)) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  if (ext === ".docx") {
    const { value } = await mammoth.extractRawText({ buffer: await readFile(absPath) });
    return value;
  }
  if (ext === ".html" || ext === ".htm") {
    return htmlToText(await readFile(absPath, "utf8"), HTML_EXTRACT_OPTIONS).trim();
  }
  return readFile(absPath, "utf8");
}

function normalize(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips NUL bytes from extracted document text before storage/indexing
      .replace(/\u0000/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, MAX_TEXT_LENGTH)
  );
}

/**
 * Split into contiguous slices of roughly CHUNK_TARGET characters, breaking at
 * a paragraph, line or sentence boundary in the second half of the window.
 * Slices are exact (no trimming), so joining them restores the text.
 */
function chunkText(text: string, target = CHUNK_TARGET): string[] {
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + target, text.length);
    if (end < text.length) {
      const windowStart = pos + Math.floor(target / 2);
      const window = text.slice(windowStart, end);
      for (const boundary of ["\n\n", "\n", ". "]) {
        const at = window.lastIndexOf(boundary);
        if (at !== -1) {
          end = windowStart + at + boundary.length;
          break;
        }
      }
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}

/** Every non-hidden file under the library folder, as paths relative to it — supported or not. */
async function listFiles(): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const found = new Map<string, { size: number; mtimeMs: number }>();
  const visit = async (rel: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(join(libraryDir, rel), { withFileTypes: true });
    } catch (error) {
      // A permission-denied or vanished subfolder must not abort the whole
      // scan — skip this subtree and keep indexing the rest.
      ingestLog.warn({ err: error, rel }, "skipping unreadable library directory");
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(relPath);
      } else if (entry.isFile()) {
        try {
          const info = await stat(join(libraryDir, relPath));
          found.set(relPath, { size: info.size, mtimeMs: Math.round(info.mtimeMs) });
        } catch {
          // Vanished between readdir and stat — the follow-up scan reconciles it away.
        }
      }
    }
  };
  await visit("");
  return found;
}

async function indexFile(relPath: string, size: number, mtimeMs: number): Promise<boolean> {
  const ext = extname(relPath).toLowerCase();
  const base = {
    path: relPath,
    title: basename(relPath, extname(relPath)),
    ext: ext.slice(1),
    size,
    mtimeMs,
  };
  // Unsupported and oversized files still get a visible row — just no
  // extraction or chunking, so a stray spreadsheet or image is never read.
  if (size > MAX_FILE_SIZE) {
    store.replaceDocument(
      { ...base, status: "error", error: "file too large to index", textLength: 0 },
      [],
    );
    return false;
  }
  if (!LIBRARY_EXTENSIONS.has(ext)) {
    store.replaceDocument(
      {
        ...base,
        status: "error",
        error: `unsupported file format — supported: ${SUPPORTED_FORMATS}`,
        textLength: 0,
      },
      [],
    );
    return false;
  }
  try {
    const text = normalize(await extractText(join(libraryDir, relPath), ext));
    if (!text) {
      store.replaceDocument(
        {
          ...base,
          status: "error",
          error: "no readable text in this file — a scanned PDF has no text layer",
          textLength: 0,
        },
        [],
      );
      return false;
    }
    store.replaceDocument(
      { ...base, status: "indexed", error: null, textLength: text.length },
      chunkText(text),
    );
    return true;
  } catch (error) {
    store.replaceDocument(
      { ...base, status: "error", error: errorMessage(error), textLength: 0 },
      [],
    );
    return false;
  }
}

interface ScanSummary {
  indexed: number;
  failed: number;
  removed: number;
}

let scanning: Promise<ScanSummary> | null = null;
let rescanWanted = false;

/** Reconcile the folder with the index. Concurrent calls share one scan. */
function scanLibrary(): Promise<ScanSummary> {
  if (scanning) {
    rescanWanted = true;
    return scanning;
  }
  scanning = doScan().finally(() => {
    scanning = null;
    if (rescanWanted) {
      rescanWanted = false;
      scanLibrary().catch((error: unknown) =>
        ingestLog.error({ err: error }, "chained library rescan failed"),
      );
    }
  });
  return scanning;
}

/** Wait out any in-flight scan (and its chained rescans) — used around folder switches. */
async function drainScanning(): Promise<void> {
  while (scanning) {
    await scanning.catch(() => {});
  }
}

/** Two stats ~500ms apart: true while the file is still being written to. */
async function isStillChanging(relPath: string): Promise<boolean> {
  const absPath = join(libraryDir, relPath);
  try {
    const before = await stat(absPath);
    await sleep(QUIESCENCE_WAIT_MS);
    const after = await stat(absPath);
    return after.size !== before.size || after.mtimeMs !== before.mtimeMs;
  } catch {
    // Vanished mid-check — the follow-up scan reconciles it away.
    return true;
  }
}

async function doScan(): Promise<ScanSummary> {
  await mkdir(libraryDir, { recursive: true });
  const files = await listFiles();
  const documents = await store.listDocuments();
  const summary: ScanSummary = { indexed: 0, failed: 0, removed: 0 };

  for (const doc of documents) {
    if (!files.has(doc.path)) {
      store.removeDocument(doc.id);
      summary.removed += 1;
    }
  }

  const byPath = new Map(documents.map((d) => [d.path, d]));
  let settling = false;
  for (const [relPath, info] of files) {
    const known = byPath.get(relPath);
    const unchanged =
      known &&
      known.size === info.size &&
      known.modifiedAt === new Date(info.mtimeMs).toISOString();
    if (unchanged) continue;
    // A just-modified file may still be copying in. If it's visibly growing,
    // skip it this round — no error row for a half-written file — and let the
    // follow-up scan below index it once the copy settles.
    if (Date.now() - info.mtimeMs < QUIESCENCE_RECENT_MS && (await isStillChanging(relPath))) {
      settling = true;
      continue;
    }
    // Serial on purpose: one PDF parses at a time so a folder full of files
    // never spikes the CPU under a running chat.
    if (await indexFile(relPath, info.size, info.mtimeMs)) summary.indexed += 1;
    else summary.failed += 1;
  }
  if (settling) scheduleScan(QUIESCENCE_RESCAN_MS);
  // Every (re)index funnels through here — notes, uploads, external drops.
  if (summary.indexed || summary.failed || summary.removed) emitServerEvent("library");
  return summary;
}

let watcher: FSWatcher | null = null;
let scanTimer: NodeJS.Timeout | null = null;
let watcherRetryTimer: NodeJS.Timeout | null = null;
/** Bumped every time stopWatcher() tears a watcher down (folder switch, or
 *  the top of every startWatcher() call). A delayed retry captures the
 *  generation live when it was armed and checks it before resurrecting a
 *  watcher, so it never fires for a folder that's since been switched away
 *  from or a watcher that's already been re-armed by another attempt. */
let watcherGeneration = 0;
const WATCHER_RETRY_MS = 30_000;

/** Debounced scan trigger, shared by the folder watcher and settle retries. */
function scheduleScan(delayMs: number): void {
  if (scanTimer) clearTimeout(scanTimer);
  scanTimer = setTimeout(() => {
    scanLibrary().catch((error: unknown) =>
      ingestLog.error({ err: error }, "scheduled library scan failed"),
    );
  }, delayMs);
}

function stopWatcher(): void {
  watcher?.close();
  watcher = null;
  watcherGeneration += 1;
  // A pending debounced scan targets whatever folder was active when it was
  // armed; left running, it can fire against libraryDir mid-switch (see
  // setLibraryFolder). Cancel it whenever the watcher is torn down.
  if (scanTimer) {
    clearTimeout(scanTimer);
    scanTimer = null;
  }
  // Likewise a pending watcher-restart retry belongs to the watcher just
  // closed — drop it so it can't resurrect a watcher for a folder that's
  // being switched away from.
  if (watcherRetryTimer) {
    clearTimeout(watcherRetryTimer);
    watcherRetryTimer = null;
  }
}

function startWatcher(): void {
  stopWatcher();
  const generation = watcherGeneration;
  try {
    const instance = watch(libraryDir, { recursive: true }, () => scheduleScan(1000));
    watcher = instance;
    instance.on("error", (error) => {
      // A stray event from a watcher already superseded by a folder switch
      // or an earlier retry — this generation is no longer current, so
      // there's nothing to close or retry.
      if (watcherGeneration !== generation) return;
      ingestLog.warn(
        { err: error, folder: libraryDir },
        `library watcher failed — retrying in ${WATCHER_RETRY_MS / 1000}s`,
      );
      instance.close();
      watcher = null;
      watcherRetryTimer = setTimeout(() => {
        watcherRetryTimer = null;
        // Stale by the time the backoff elapsed — folder switched, or the
        // watcher was already re-armed some other way. Re-arming here would
        // resurrect a watcher nobody wants.
        if (watcherGeneration !== generation) return;
        startWatcher();
      }, WATCHER_RETRY_MS);
    });
  } catch {
    // No folder watching on this platform — boot scans and the UI's rescan still work.
  }
}

/** Resolve the folder (saved setting, else env default), index it, and keep watching it. */
export async function startLibrary(log: (message: string) => void): Promise<void> {
  const saved = await getLibraryFolderSetting();
  libraryDir = resolveFolder(saved ?? env.libraryPath);
  await mkdir(libraryDir, { recursive: true });
  scanLibrary()
    .then((s) => {
      if (s.indexed || s.failed || s.removed) {
        log(`Library scan: ${s.indexed} indexed, ${s.removed} removed, ${s.failed} failed`);
      }
    })
    .catch((error: unknown) => ingestLog.error({ err: error }, "initial library scan failed"));
  startWatcher();
}

/** Close the folder watcher and cancel pending scans; startLibrary() re-arms. */
export function stopLibrary(): void {
  stopWatcher();
}

/**
 * Point the library at a different folder. Validates and creates the folder,
 * waits out any in-flight scan (which still reads the old folder), then
 * persists the choice, re-points the watcher and rescans — the reconcile
 * drops rows whose files aren't in the new folder and indexes what is.
 */
export async function setLibraryFolder(input: string): Promise<void> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("folder path is empty");
  const next = resolveFolder(trimmed);
  if (next === resolve("/")) throw new Error("the filesystem root cannot be the library folder");
  try {
    await mkdir(next, { recursive: true });
  } catch (error) {
    throw new Error(`cannot create the folder: ${errorMessage(error)}`);
  }
  // A scan started before the switch reads the old folder; changing the
  // module variable under it would mix the two. Follow-up scans chain onto
  // `scanning`, so wait until none is left.
  await drainScanning();
  await setSetting(LIBRARY_FOLDER_SETTING_KEY, next);
  // stopWatcher() also cancels any pending debounced scan timer, but that
  // timer could have already fired during the awaits above and started a
  // scan of the OLD folder — drain it too, so nothing is in flight reading
  // libraryDir when it's reassigned just below.
  stopWatcher();
  await drainScanning();
  libraryDir = next;
  startWatcher();
  await scanLibrary();
}

/**
 * Write `data` into the library, or a subfolder of it (`relDir`, `""` for the
 * root), under a hidden temp name, then rename it to `name`: the scanner
 * skips dotfiles, so a partially written file is never visible to it. Cleans
 * up the temp file on failure, and always rescans on success so the new file
 * is indexed. Returns the path relative to the library root.
 */
async function writeIntoLibrary(
  relDir: string,
  name: string,
  tempPrefix: string,
  data: string | Buffer,
): Promise<string> {
  const dir = relDir ? join(libraryDir, relDir) : libraryDir;
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.${tempPrefix}-${randomUUID()}`);
  try {
    await writeFile(tempPath, data);
    await rename(tempPath, join(dir, name));
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
  await scanLibrary();
  return relDir ? `${relDir}/${name}` : name;
}

/** File name is taken as-is (basename only); returns the stored relative path. */
export async function saveUpload(fileName: string, data: Buffer): Promise<string> {
  const name = basename(fileName.trim());
  if (!name || name.startsWith(".")) throw new Error("invalid file name");
  if (!LIBRARY_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw new Error(`unsupported file type — use ${[...LIBRARY_EXTENSIONS].join(", ")}`);
  }
  return writeIntoLibrary("", name, "upload", data);
}

/**
 * Save a markdown note under notes/ in the library. Title is turned into a
 * safe filename (basename only, no traversal); saving the same title again
 * overwrites the note — how the agent updates one. Returns the stored
 * relative path.
 */
export async function saveNote(title: string, content: string): Promise<string> {
  const base = basename(title.trim());
  if (!base || base.startsWith(".")) throw new Error("invalid note title");
  const name = extname(base).toLowerCase() === ".md" ? base : `${base}.md`;
  const trimmedContent = content.trim();
  if (!trimmedContent) throw new Error("note content must not be empty");

  return writeIntoLibrary("notes", name, "note", trimmedContent);
}

/**
 * Delete a document: its file in the folder and its index entry. The file is
 * removed only when its stored path resolves inside the library folder
 * (resolveLibraryPath) — a traversal path in a row must never delete outside
 * it; the index row is dropped either way.
 */
export async function deleteDocument(id: string): Promise<boolean> {
  const doc = await store.getDocument(id);
  if (!doc) return false;
  const absPath = resolveLibraryPath(libraryDir, doc.path);
  if (absPath) await rm(absPath, { force: true });
  store.removeDocument(id);
  emitServerEvent("library");
  return true;
}
