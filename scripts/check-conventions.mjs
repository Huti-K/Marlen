#!/usr/bin/env node
/**
 * Enforces the CLAUDE.md conventions that no linter rule covers:
 *
 *  1. Source files stay under 800 lines (seed/fixture data exempt).
 *  2. Tests live in apps/server/test/, never colocated in a src/ tree.
 *  3. Provider registration (registerDraftProvider / registerMailReadProvider /
 *     registerAttachmentProvider) is called only from register*.ts files —
 *     never as a module side effect elsewhere.
 *
 * Zero dependencies; runs in <1s. Exits 1 with a list of violations.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_LINES = 800;

// Seed/fixture data is exempt from the line cap.
const FIXTURE_FILE = /(^|\/)(fixtures?|samples?|seed)[^/]*\.(ts|tsx)$/;

const SOURCE_FILE = /^(apps|packages)\/[^/]+\/src\/.+\.(ts|tsx)$/;
const COLOCATED_TEST = /\.(test|spec)\.(ts|tsx)$/;

const REGISTER_CALL =
  /\b(registerDraftProvider|registerMailReadProvider|registerAttachmentProvider)\s*\(/;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((f) => SOURCE_FILE.test(f));

const errors = [];

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
    errors.push(`${file}: ${lineCount} lines exceeds the ${MAX_LINES}-line cap — split by concern`);
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

for (const e of errors) console.error(`error ${e}`);

if (errors.length > 0) {
  console.error(`\nconventions check failed: ${errors.length} violation(s)`);
  process.exit(1);
}
console.log(`conventions check passed (${files.length} source files)`);
