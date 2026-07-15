import { promises as fs } from "node:fs";
import { dirname } from "node:path";

/**
 * Write `contents` to `path` without ever leaving a truncated/corrupt file
 * behind on a crash or power loss mid-write: ensure the parent directory
 * exists, write to a temp file in the same directory at `mode`, fsync it,
 * then rename over the target (same-filesystem rename is atomic).
 */
export async function writeFileAtomic(path: string, contents: string, mode = 0o600): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  const handle = await fs.open(tempPath, "w", mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, path);
}
