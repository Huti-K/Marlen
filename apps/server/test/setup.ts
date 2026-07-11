import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Test isolation, applied before any src module loads (vitest setupFiles):
 *
 * - Every worker gets its own scratch database file. db/index.ts opens
 *   lazily, so the first query in a test hits this path, never the real
 *   data/trailin.db.
 * - Credentials are neutralized: dotenv never overrides variables that are
 *   already set, and env.ts's optional() treats "" as unset — so a
 *   developer's .env can't make tests call Pipedream.
 */
process.env.DATABASE_PATH = join(tmpdir(), `trailin-test-${randomUUID()}.db`);
process.env.LOG_LEVEL = "silent";
process.env.LOG_FILE = "";
process.env.PIPEDREAM_CLIENT_ID = "";
process.env.PIPEDREAM_CLIENT_SECRET = "";
process.env.PIPEDREAM_PROJECT_ID = "";
