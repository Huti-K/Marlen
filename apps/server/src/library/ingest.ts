import { watch, type FSWatcher } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import { env } from "../env.js";
import { errorMessage } from "../util.js";
import * as store from "./store.js";

/**
 * The library drop folder: files put there (or uploaded via the web UI) are
 * extracted and indexed into SQLite so the agent can search and read them.
 * Everything runs in-process and off the request path — a scan happens on
 * boot, when the folder changes, and on demand.
 */

export const LIBRARY_EXTENSIONS = new Set([".pdf", ".md", ".markdown", ".txt"]);
export const libraryDir = resolve(process.cwd(), env.libraryPath);

/** Documents are stored whole; this only guards against pathological files. */
const MAX_TEXT_LENGTH = 2_000_000;
const CHUNK_TARGET = 1800;

async function extractText(absPath: string, ext: string): Promise<string> {
  if (ext === ".pdf") {
    const parser = new PDFParse({ data: new Uint8Array(await readFile(absPath)) });
    try {
      return (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  }
  return readFile(absPath, "utf8");
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Split into contiguous slices of roughly CHUNK_TARGET characters, breaking at
 * a paragraph, line or sentence boundary in the second half of the window.
 * Slices are exact (no trimming), so joining them restores the text.
 */
export function chunkText(text: string, target = CHUNK_TARGET): string[] {
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

/** All supported files under the library folder, as paths relative to it. */
async function listFiles(): Promise<Map<string, { size: number; mtimeMs: number }>> {
  const found = new Map<string, { size: number; mtimeMs: number }>();
  const visit = async (rel: string): Promise<void> => {
    const entries = await readdir(join(libraryDir, rel), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(relPath);
      } else if (entry.isFile() && LIBRARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        const info = await stat(join(libraryDir, relPath));
        found.set(relPath, { size: info.size, mtimeMs: Math.round(info.mtimeMs) });
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
  try {
    const text = normalize(await extractText(join(libraryDir, relPath), ext));
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

export interface ScanSummary {
  indexed: number;
  failed: number;
  removed: number;
}

let scanning: Promise<ScanSummary> | null = null;
let rescanWanted = false;

/** Reconcile the folder with the index. Concurrent calls share one scan. */
export function scanLibrary(): Promise<ScanSummary> {
  if (scanning) {
    rescanWanted = true;
    return scanning;
  }
  scanning = doScan().finally(() => {
    scanning = null;
    if (rescanWanted) {
      rescanWanted = false;
      void scanLibrary();
    }
  });
  return scanning;
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
  for (const [relPath, info] of files) {
    const known = byPath.get(relPath);
    const unchanged =
      known &&
      known.size === info.size &&
      known.modifiedAt === new Date(info.mtimeMs).toISOString();
    if (unchanged) continue;
    // Serial on purpose: one PDF parses at a time so a folder full of files
    // never spikes the CPU under a running chat.
    if (await indexFile(relPath, info.size, info.mtimeMs)) summary.indexed += 1;
    else summary.failed += 1;
  }
  return summary;
}

let watcher: FSWatcher | null = null;
let scanTimer: NodeJS.Timeout | null = null;

/** Ensure the folder exists, index it, and keep watching it for changes. */
export async function startLibrary(log: (message: string) => void): Promise<void> {
  await mkdir(libraryDir, { recursive: true });
  void scanLibrary().then((s) => {
    if (s.indexed || s.failed || s.removed) {
      log(`Library scan: ${s.indexed} indexed, ${s.removed} removed, ${s.failed} failed`);
    }
  });
  try {
    watcher = watch(libraryDir, { recursive: true }, () => {
      if (scanTimer) clearTimeout(scanTimer);
      scanTimer = setTimeout(() => void scanLibrary(), 1000);
    });
    watcher.on("error", () => {
      watcher?.close();
      watcher = null;
    });
  } catch {
    // No folder watching on this platform — boot scans and the UI's rescan still work.
  }
}

/** File name is taken as-is (basename only); returns the stored relative path. */
export async function saveUpload(fileName: string, data: Buffer): Promise<string> {
  const name = basename(fileName.trim());
  if (!name || name.startsWith(".")) throw new Error("invalid file name");
  if (!LIBRARY_EXTENSIONS.has(extname(name).toLowerCase())) {
    throw new Error(`unsupported file type — use ${[...LIBRARY_EXTENSIONS].join(", ")}`);
  }
  await mkdir(libraryDir, { recursive: true });
  await writeFile(join(libraryDir, name), data);
  await scanLibrary();
  return name;
}

/** Delete a document: its file in the folder and its index entry. */
export async function deleteDocument(id: string): Promise<boolean> {
  const doc = await store.getDocument(id);
  if (!doc) return false;
  await rm(join(libraryDir, doc.path), { force: true });
  store.removeDocument(id);
  return true;
}
