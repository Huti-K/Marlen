import { promises as fs, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// env.ts resolves the secret file path from DATABASE_PATH at import time, so
// point DATABASE_PATH at a fresh scratch directory before anything imports
// the module under test — same isolation idiom as test/routes/chat.test.ts.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-pipedream-secret-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "data", "test.db");

const { deleteClientSecret, readClientSecret, secretPath, writeClientSecret } = await import(
  "../../src/pipedream/secretFile.js"
);

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

describe("secretFile", () => {
  it("lives next to the database directory, not inside the DB itself", () => {
    expect(secretPath).toBe(
      join(dirname(join(tempDir, "data", "test.db")), "pipedream-secret.json"),
    );
  });

  it("reads as absent (undefined) when no file has been written yet", async () => {
    await expect(readClientSecret()).resolves.toBeUndefined();
  });

  it("round-trips a written secret", async () => {
    await writeClientSecret("shh-its-a-secret");
    await expect(readClientSecret()).resolves.toBe("shh-its-a-secret");
  });

  it("overwrites the previous value on a second write", async () => {
    await writeClientSecret("first");
    await writeClientSecret("second");
    await expect(readClientSecret()).resolves.toBe("second");
  });

  it("writes the file with mode 0o600", async () => {
    await writeClientSecret("mode-check");
    const stat = await fs.stat(secretPath);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  it("never leaves a .tmp file behind after a write", async () => {
    await writeClientSecret("no-leftovers");
    await expect(fs.access(`${secretPath}.tmp`)).rejects.toThrow();
  });

  it("fails loudly instead of reading a corrupt file as 'no secret'", async () => {
    await fs.mkdir(dirname(secretPath), { recursive: true });
    await fs.writeFile(secretPath, "{ not valid json", "utf8");
    await expect(readClientSecret()).rejects.toThrow();
  });

  it("deletes the file, after which reads go back to absent", async () => {
    await writeClientSecret("to-be-deleted");
    await deleteClientSecret();
    await expect(readClientSecret()).resolves.toBeUndefined();
  });

  it("deleting an already-absent file is a no-op, not an error", async () => {
    await deleteClientSecret();
    await expect(deleteClientSecret()).resolves.toBeUndefined();
  });
});
