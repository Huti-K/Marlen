import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";

/**
 * Write `contents` to `path` without ever leaving a truncated/corrupt file
 * behind on a crash or power loss mid-write: ensure the parent directory
 * exists, write to a temp file in the same directory at `mode`, fsync it,
 * then rename over the target (same-filesystem rename is atomic). The temp
 * name is unique per call so concurrent writers to the same target can't
 * publish each other's partial writes; a failed write unlinks its temp file.
 */
export async function writeFileAtomic(path: string, contents: string, mode = 0o600): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(tempPath, "w", mode);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tempPath, path);
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}
