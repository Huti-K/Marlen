import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LibraryDocument } from "@trailin/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The resolver reads document rows via the store and files under the library
// dir; both are faked — rows from an in-test map, files from a real temp dir —
// so no SQLite database or configured library folder is involved.
const docs = new Map<string, LibraryDocument>();
vi.mock("../../src/library/store.js", () => ({
  getDocument: async (id: string) => docs.get(id) ?? null,
}));

let libraryDir = "";
vi.mock("../../src/library/ingest.js", () => ({
  getLibraryDir: () => libraryDir,
}));

const { MAX_DRAFT_ATTACHMENTS, resolveLibraryAttachments } = await import(
  "../../src/library/draftAttachments.js"
);

function doc(id: string, path: string, overrides: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    id,
    path,
    title: path,
    ext: path.split(".").pop() ?? "",
    size: 0,
    status: "indexed",
    error: null,
    chunkCount: 1,
    textLength: 10,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    indexedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

beforeAll(async () => {
  libraryDir = await mkdtemp(join(tmpdir(), "trailin-draft-attachments-"));
  await mkdir(join(libraryDir, "notes"), { recursive: true });
  await writeFile(join(libraryDir, "expose.pdf"), Buffer.from("PDFBYTES"));
  await writeFile(join(libraryDir, "notes", "memo.md"), "note text");
  await writeFile(join(libraryDir, "data.xyz"), Buffer.from("odd"));
  await writeFile(join(libraryDir, "scan.pdf"), Buffer.from("SCANNED"));
  await writeFile(join(libraryDir, "big-a.pdf"), Buffer.alloc(8 * 1024 * 1024, 1));
  await writeFile(join(libraryDir, "big-b.pdf"), Buffer.alloc(8 * 1024 * 1024, 2));
});

afterAll(async () => {
  await rm(libraryDir, { recursive: true, force: true });
});

beforeEach(() => {
  docs.clear();
  docs.set("d-pdf", doc("d-pdf", "expose.pdf"));
  docs.set("d-md", doc("d-md", "notes/memo.md"));
  docs.set("d-unknown-ext", doc("d-unknown-ext", "data.xyz"));
  docs.set(
    "d-error",
    doc("d-error", "scan.pdf", { status: "error", error: "no readable text in this file" }),
  );
  docs.set("d-missing-file", doc("d-missing-file", "gone.pdf"));
  docs.set("d-escape", doc("d-escape", "../outside.pdf"));
  docs.set("d-big-a", doc("d-big-a", "big-a.pdf", { size: 8 * 1024 * 1024 }));
  docs.set("d-big-b", doc("d-big-b", "big-b.pdf", { size: 8 * 1024 * 1024 }));
});

describe("resolveLibraryAttachments", () => {
  it("resolves bytes, MIME type and basename filename per document", async () => {
    const resolved = await resolveLibraryAttachments(["d-pdf", "d-md"]);

    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.filename).toBe("expose.pdf");
    expect(resolved[0]?.mimeType).toBe("application/pdf");
    expect(resolved[0]?.content.toString("utf8")).toBe("PDFBYTES");
    // Nested path: the attachment name is the file's basename, not the relative path.
    expect(resolved[1]?.filename).toBe("memo.md");
    expect(resolved[1]?.mimeType).toBe("text/plain; charset=utf-8");
    expect(resolved[1]?.content.toString("utf8")).toBe("note text");
  });

  it("falls back to application/octet-stream for an unknown extension", async () => {
    const resolved = await resolveLibraryAttachments(["d-unknown-ext"]);
    expect(resolved[0]?.mimeType).toBe("application/octet-stream");
  });

  it("steers toward library_list for an unknown id", async () => {
    await expect(resolveLibraryAttachments(["nope"])).rejects.toThrow(
      /No library document with id "nope".*library_list/,
    );
  });

  it("reports a row whose file has vanished from the folder", async () => {
    await expect(resolveLibraryAttachments(["d-missing-file"])).rejects.toThrow(
      /missing from the library folder/,
    );
  });

  it("caps the attachment count", async () => {
    const ids = Array.from({ length: MAX_DRAFT_ATTACHMENTS + 1 }, (_, i) => `id-${i}`);
    await expect(resolveLibraryAttachments(ids)).rejects.toThrow(/at most 5/);
  });

  it("caps the total raw size across attachments", async () => {
    await expect(resolveLibraryAttachments(["d-big-a", "d-big-b"])).rejects.toThrow(
      /over the 15.0 MB attachment limit/,
    );
  });

  it("attaches a document whose indexing failed — the file itself is fine to send", async () => {
    const resolved = await resolveLibraryAttachments(["d-error"]);
    expect(resolved[0]?.filename).toBe("scan.pdf");
    expect(resolved[0]?.content.toString("utf8")).toBe("SCANNED");
  });

  it("deduplicates repeated ids", async () => {
    const resolved = await resolveLibraryAttachments(["d-pdf", "d-pdf"]);
    expect(resolved).toHaveLength(1);
  });

  it("rejects a document path that resolves outside the library folder", async () => {
    await expect(resolveLibraryAttachments(["d-escape"])).rejects.toThrow(
      /outside the library folder/,
    );
  });

  it("returns no attachments for an empty id list", async () => {
    expect(await resolveLibraryAttachments([])).toEqual([]);
  });
});
