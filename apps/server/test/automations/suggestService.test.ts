import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// db/index.ts runs its DDL as an import-time side effect against env.ts's
// DATABASE_PATH read, also at import time — same pattern as
// test/db/learnRuns.test.ts — so this suite gets its own scratch database.
const tempDir = mkdtempSync(join(tmpdir(), "trailin-suggest-service-"));
const originalDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = join(tempDir, "test.db");

const { closeDb, db, schema } = await import("../../src/db/index.js");
const { setSetting } = await import("../../src/db/settings.js");
const { createSuggestion, listPendingSuggestions } = await import(
  "../../src/db/automationSuggestions.js"
);
const { runSuggestSweep } = await import("../../src/automations/suggestService.js");

afterAll(() => {
  closeDb();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = originalDatabasePath;
});

/** Push the last-sweep stamp far into the past so the ~daily guard lets the next sweep run. */
async function resetSweepGuard(): Promise<void> {
  await setSetting("automations.suggestLastSweepAt", "2000-01-01T00:00:00.000Z");
}

/** ISO timestamp `hoursAgo` hours in the past — inside the sweep's 14-day window. */
function recentIso(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

async function seedConversation(type: "chat" | "automation"): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.conversations).values({
    id,
    title: "seeded",
    type,
    createdAt: recentIso(24 * 7),
  });
  return id;
}

async function seedMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
): Promise<void> {
  await db.insert(schema.messages).values({
    id: randomUUID(),
    conversationId,
    role,
    content,
    createdAt,
  });
}

describe("runSuggestSweep", () => {
  it("completes without an LLM call when there are too few recent requests, and stamps the guard", async () => {
    const propose = vi.fn();
    const result = await runSuggestSweep({ propose });
    expect(result).toMatchObject({ ran: true, proposed: 0, stored: 0 });
    expect(propose).not.toHaveBeenCalled();

    // The completed sweep stamped the timestamp: an immediate rerun is skipped.
    const again = await runSuggestSweep({ propose });
    expect(again).toMatchObject({ ran: false, skipped: "recent-sweep" });
  });

  it("renders requests with context, stores valid proposals, drops invalid cron and duplicates", async () => {
    await resetSweepGuard();

    const chat = await seedConversation("chat");
    for (let i = 0; i < 6; i++) {
      await seedMessage(chat, "user", `summarize my inbox please (${i})`, recentIso(24 * i + 8));
    }
    await seedMessage(chat, "assistant", "assistant-reply-not-a-request", recentIso(5));
    const automationConversation = await seedConversation("automation");
    await seedMessage(automationConversation, "user", "automation-run-instruction", recentIso(6));

    await db.insert(schema.automations).values({
      id: randomUUID(),
      name: "Morning briefing",
      instruction: "Review the mail from the last 24 hours.",
      schedule: "0 8 * * *",
      enabled: false,
      showInActivity: true,
      pinned: false,
      createdAt: recentIso(24 * 30),
    });
    const dismissed = await createSuggestion({
      name: "Old idea",
      instruction: "Do the old thing.",
      schedule: "0 9 * * *",
      rationale: "Seen before.",
    });
    const { decideSuggestion } = await import("../../src/db/automationSuggestions.js");
    await decideSuggestion(dismissed.id, "dismissed");

    const propose = vi.fn().mockResolvedValue([
      {
        name: "Inbox summary",
        instruction: "Summarize the inbox across all accounts and report highlights.",
        schedule: "0 8 * * *",
        rationale: "You asked for inbox summaries six times.",
      },
      {
        name: "Broken cron",
        instruction: "Whatever.",
        schedule: "not-a-cron",
        rationale: "Invalid.",
      },
      {
        name: "morning briefing", // duplicates the existing automation, case-insensitively
        instruction: "Duplicate.",
        schedule: "0 8 * * *",
        rationale: "Duplicate.",
      },
    ]);

    const result = await runSuggestSweep({ propose });
    expect(result).toMatchObject({ ran: true, proposed: 3, stored: 1 });

    const prompt = propose.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("The user's timezone:");
    expect(prompt).toContain("summarize my inbox please (0)");
    expect(prompt).toContain('"Morning briefing" — 0 8 * * *');
    expect(prompt).toContain('[dismissed] "Old idea"');
    expect(prompt).not.toContain("assistant-reply-not-a-request");
    expect(prompt).not.toContain("automation-run-instruction");

    const pending = await listPendingSuggestions();
    expect(pending.map((s) => s.name)).toEqual(["Inbox summary"]);
  });

  it("caps stored proposals so pending never exceeds the queue limit", async () => {
    await resetSweepGuard();
    const propose = vi.fn().mockResolvedValue(
      ["Second idea", "Third idea", "Fourth idea", "Fifth idea"].map((name) => ({
        name,
        instruction: `Do the ${name} task and report.`,
        schedule: "0 7 * * *",
        rationale: "Recurs.",
      })),
    );

    // One suggestion is already pending from the previous test; the queue cap
    // is 3, so only two of the four proposals may land.
    const result = await runSuggestSweep({ propose });
    expect(result).toMatchObject({ ran: true, proposed: 4, stored: 2 });
    expect(await listPendingSuggestions()).toHaveLength(3);
  });

  it("skips entirely — no LLM call — while the pending queue is full", async () => {
    await resetSweepGuard();
    const propose = vi.fn();
    const result = await runSuggestSweep({ propose });
    expect(result).toMatchObject({ ran: false, skipped: "pending-full" });
    expect(propose).not.toHaveBeenCalled();
  });
});
