import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { formatFileSize } from "@trailin/shared";
import type { DraftAttachment } from "../email/providers.js";
import { mimeForExt } from "../utils/fileResponse.js";
import { getLibraryDir, resolveLibraryPath } from "./ingest.js";
import * as store from "./store.js";

/**
 * Resolve library document ids into DraftAttachments (filename + MIME +
 * bytes) for the create-draft tools. The library is the only attachment
 * source the agent has, so every failure here throws an Error whose message
 * steers the model toward a fix (wrong id → library_list, too big → attach
 * fewer) — the caller returns it as tool result text without creating a
 * draft.
 *
 * A document with status "error" (e.g. a scanned PDF with no text layer) is
 * still attachable: indexing failed, but the file itself is fine to send.
 * Only the DB row and the file on disk have to exist.
 */

/** Attachment count cap per draft. */
export const MAX_DRAFT_ATTACHMENTS = 5;

/**
 * Total raw bytes across all attachments. Gmail caps the encoded message at
 * 25 MB and base64 inflates by ~4/3, so 15 MB of raw bytes keeps the built
 * message safely under that on every provider.
 */
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;

interface ResolvedFile {
  absPath: string;
  filename: string;
  mimeType: string;
  size: number;
}

async function resolveOne(id: string, libraryDir: string): Promise<ResolvedFile> {
  const doc = await store.getDocument(id);
  if (!doc) {
    throw new Error(
      `No library document with id "${id}" — use library_list or library_search to find the ` +
        `right id, and pass ids exactly as listed.`,
    );
  }

  // doc.path is written by the library's own scanner, but confine it anyway:
  // the resolved file must stay under the library folder, so a row can never
  // point an attachment at an arbitrary file on disk.
  const absPath = resolveLibraryPath(libraryDir, doc.path);
  if (!absPath) {
    throw new Error(
      `Library document "${doc.title}" points outside the library folder and cannot be attached.`,
    );
  }

  try {
    const info = await stat(absPath);
    return {
      absPath,
      filename: basename(doc.path),
      mimeType: mimeForExt(extname(doc.path)),
      size: info.size,
    };
  } catch {
    throw new Error(
      `The file for library document "${doc.title}" (${doc.path}) is missing from the library ` +
        `folder — it may have been moved or deleted. Use library_list to see what is available.`,
    );
  }
}

/**
 * Resolve `documentIds` (deduplicated, order preserved) to attachment bytes,
 * enforcing the count and total-size caps before any file is read.
 */
export async function resolveLibraryAttachments(documentIds: string[]): Promise<DraftAttachment[]> {
  const ids = [...new Set(documentIds)];
  if (ids.length === 0) return [];
  if (ids.length > MAX_DRAFT_ATTACHMENTS) {
    throw new Error(
      `Too many attachments: ${ids.length} documents requested, but a draft can carry at most ` +
        `${MAX_DRAFT_ATTACHMENTS}. Attach only the most relevant ones.`,
    );
  }

  const libraryDir = getLibraryDir();
  const files: ResolvedFile[] = [];
  for (const id of ids) {
    files.push(await resolveOne(id, libraryDir));
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(
      `These documents total ${formatFileSize(totalBytes)}, over the ` +
        `${formatFileSize(MAX_TOTAL_ATTACHMENT_BYTES)} attachment limit per draft. ` +
        `Attach fewer or smaller files.`,
    );
  }

  return Promise.all(
    files.map(
      async (file): Promise<DraftAttachment> => ({
        filename: file.filename,
        mimeType: file.mimeType,
        content: await readFile(file.absPath),
      }),
    ),
  );
}
