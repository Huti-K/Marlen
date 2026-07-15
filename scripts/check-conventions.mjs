#!/usr/bin/env node
/**
 * Enforces the CLAUDE.md conventions that no linter rule covers:
 *
 *  1. Source files stay under 800 lines (seed/fixture data exempt).
 *  2. Tests live in apps/server/test/, never colocated in a src/ tree.
 *  3. Provider registration (registerDraftProvider / registerSyncProvider /
 *     registerAttachmentProvider) is called only from register*.ts files —
 *     never as a module side effect elsewhere.
 *
 * Zero dependencies; runs in <1s. Exits 1 with a list of violations.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_LINES = 800;

// Files that predate the line cap. Shrink this list by splitting them —
// never add to it.
const GRANDFATHERED_OVER_LIMIT = new Set([
  "apps/web/src/components/SearchPalette.tsx",
  "apps/web/src/features/chat/ChatPanel.tsx",
  "apps/web/src/features/knowledge/KnowledgePanel.tsx",
  "apps/web/src/features/showcase/ShowcasePanel.tsx",
]);

// Seed/fixture data is exempt from the line cap.
const FIXTURE_FILE = /(^|\/)(fixtures?|samples?|seed)[^/]*\.(ts|tsx)$/;

const SOURCE_FILE = /^(apps|packages)\/[^/]+\/src\/.+\.(ts|tsx)$/;
const COLOCATED_TEST = /\.(test|spec)\.(ts|tsx)$/;

const REGISTER_CALL =
  /\b(registerDraftProvider|registerSyncProvider|registerAttachmentProvider)\s*\(/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => SOURCE_FILE.test(f));

const errors = [];
const warnings = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted but still listed (staged deletion)
  }

  if (COLOCATED_TEST.test(file)) {
    errors.push(`${file}: tests live in apps/server/test/ (mirroring src/), never in src/`);
  }

  const lineCount = text.split("\n").length;
  if (lineCount > MAX_LINES && !FIXTURE_FILE.test(file)) {
    if (GRANDFATHERED_OVER_LIMIT.has(file)) {
      warnings.push(`${file}: ${lineCount} lines (grandfathered — split by concern when touched)`);
    } else {
      errors.push(
        `${file}: ${lineCount} lines exceeds the ${MAX_LINES}-line cap — split by concern`,
      );
    }
  }

  const basename = file.slice(file.lastIndexOf("/") + 1);
  if (!basename.startsWith("register")) {
    text.split("\n").forEach((line, i) => {
      if (REGISTER_CALL.test(line)) {
        errors.push(
          `${file}:${i + 1}: provider registration belongs in a register*.ts file, not here`,
        );
      }
    });
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);

if (errors.length > 0) {
  console.error(`\nconventions check failed: ${errors.length} violation(s)`);
  process.exit(1);
}
console.log(`conventions check passed (${files.length} source files)`);
