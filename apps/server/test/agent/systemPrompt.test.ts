import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * The system prompt's ceiling, against the state that actually causes trouble:
 * a memory folder written from outside the app, holding more and longer
 * entries than the API would ever accept. The prompt rides on every turn and
 * compaction can never trim it, so a breach here silently costs every
 * conversation its context.
 */

let prompt: typeof import("../../src/agent/prompt.js");
let memoryDir: string;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-prompt-test-"));
  process.env.AGENT_HOME_PATH = join(scratch, "Marlen");
  process.env.DATABASE_PATH = join(scratch, "test.db");
  const home = await import("../../src/storage/home/agentHome.js");
  await home.ensureAgentHome();
  prompt = await import("../../src/agent/prompt.js");
  memoryDir = join(process.env.AGENT_HOME_PATH, "memory");
  await mkdir(memoryDir, { recursive: true });
});

const caps: import("../../src/agent/capabilities.js").SessionCapabilities = {
  interactive: true,
  onOffice: { configured: false, writes: false, creates: false },
  whatsapp: { linked: false, mirror: false, sends: false },
};

/** A memory file as a hand-edit or an external tool could leave it: oversized. */
async function writeMemory(id: string, chars: number): Promise<void> {
  await writeFile(join(memoryDir, `${id}.md`), `${id} `.repeat(Math.ceil(chars / (id.length + 1))));
}

describe("the system prompt", () => {
  it("stays under its ceiling however far memory has ballooned", async () => {
    const clean = await prompt.buildSystemPrompt(caps);
    expect(clean.length).toBeLessThan(prompt.SYSTEM_PROMPT_MAX_CHARS);

    // 300 entries of 20k chars: 6M characters, ~75x the ceiling on its own.
    await Promise.all(
      Array.from({ length: 300 }, (_, i) => writeMemory(`ballooned-memory-${i}`, 20_000)),
    );

    const ballooned = await prompt.buildSystemPrompt(caps);
    expect(ballooned.length).toBeLessThanOrEqual(prompt.SYSTEM_PROMPT_MAX_CHARS);
    // Bounded, but the memory it did fit is really there.
    expect(ballooned).toContain("Long-term memory");
    expect(ballooned).toContain("ballooned-memory-");
    // And the agent is told to tidy up rather than left to wonder.
    expect(ballooned).toContain("memory_update");
  });

  it("truncates an oversized entry into the prompt without touching the file", async () => {
    const body = `remember this ${"and this ".repeat(4_000)}`;
    await writeFile(join(memoryDir, "oversized-entry.md"), body);

    const built = await prompt.buildSystemPrompt(caps);
    expect(built.length).toBeLessThanOrEqual(prompt.SYSTEM_PROMPT_MAX_CHARS);
    expect(built).toContain("Read the whole entry with file_read on memory/oversized-entry.md");

    // The entry is trimmed on the way into the prompt, never on disk: the
    // user's own words are not the app's to shorten.
    expect((await readFile(join(memoryDir, "oversized-entry.md"), "utf8")).length).toBe(
      body.length,
    );
  });
});
