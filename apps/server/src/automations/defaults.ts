import { createHash, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getSetting, setSetting } from "../db/settings.js";
import { moduleLogger } from "../logger.js";

const log = moduleLogger("automations");

/**
 * Built-in automations a fresh install ships with. Once seeded, the user owns
 * their copies outright — edit, disable, rename or delete them like any other.
 * The text below is the verbatim source of truth; see seedDefaultAutomations
 * for when it is applied.
 */
interface DefaultAutomation {
  name: string;
  schedule: string;
  enabled: boolean;
  showInActivity: boolean;
  instruction: string;
}

const DEFAULT_AUTOMATIONS: DefaultAutomation[] = [
  {
    name: `Morning briefing`,
    schedule: "0 8 * * *",
    enabled: true,
    showInActivity: true,
    instruction: `Across all connected email accounts, review the messages received since yesterday (roughly the last 24 hours), triage them, draft the replies that are warranted, and publish the result as a structured briefing.

REVIEW: Start from the local mail index: list_threads covers every account in one call, and each line already carries the thread's enriched gist, triage, urgency and deadline (pass refresh true so the very latest mail is included). Scan the recent threads, then run a second pass with filter "needs_attention" so nothing the enrichment flagged slips through. Read in full (read_thread) only the threads that will become briefing items or drafts — the printed gists are enough to dismiss the rest — and when many threads need a full read, fan the read-and-summarize work out with the delegate tool rather than working through them serially. read_thread quotes saved context about each participant; use it, and lookup_contact when you need more background on a sender, to judge how much a thread really matters. Also call list_waiting_threads, so a thread that has been sitting unanswered for days can be raised alongside today's mail.

TRIAGE: Put every noteworthy message in exactly one tier. "urgent" when it is time-sensitive, a deadline could pass, or somebody is blocked on me. "reply" when a real person is waiting on my answer but nothing is on fire. "action" when it needs a decision or a task from me and nobody is waiting. "fyi" when it is worth knowing and needs nothing. The triage printed on a list_threads line is a hint, not the verdict — override it when the full thread reads differently. Newsletters, promotions, receipts, shipping updates and automated notifications are not items at all: count them into a rollup instead.

DRAFTS (only where it genuinely makes sense): For threads that actually warrant a reply from me, ACTUALLY CREATE THE DRAFT by calling that account's create-draft tool (the exact tool name varies by provider and account, use the one whose description says it acts as that account) so a real unsent draft is saved to my Drafts folder; do not merely write the draft text in your report. Attach it to the original thread by passing the thread's threadId from the list_threads/read_thread results so it threads correctly. A reply is warranted when a real person is asking me something, is awaiting my response, or the thread needs an action or acknowledgement from me. Do NOT draft for newsletters, marketing/promotions, receipts, shipping/order updates, calendar invites, automated or no-reply notifications, or threads I have already answered (when in doubt, skip it). Write each draft concisely, in my usual tone, and in the same language as the email it replies to. Never send, reply, forward, label, or delete anything, only save drafts for me to review.

PUBLISH: Call compose_briefing exactly once, at the very end, with every triaged item. Give each item the real threadId from the list_threads/read_thread results and the account it arrived in, carry over the deadline when one is known, and set draftId on any item you drafted a reply for, so the card's actions work. Roll the low-value mail up by kind ("Newsletters", "Receipts", "Promotions") with counts and a few example senders.

CLOSE: The card is the report, so do not repeat the items in prose — compose_briefing's own result tells you exactly how to close the turn.`,
  },
];

const DEFAULTS_SEEDED_KEY = "automations.defaultsSeeded";

/**
 * sha256 of every instruction text a previous version of Trailin ever seeded,
 * keyed by automation name. A stored instruction whose hash appears here was
 * written by us and never touched by the user, so it is safe to replace with
 * the current text above — that is how prompt improvements (e.g. the digest's
 * importance ordering) reach installs that were seeded long ago.
 *
 * Anything not listed is the user's own prose and is never overwritten. Add a
 * hash here whenever you change a DEFAULT_AUTOMATIONS instruction; drop none.
 */
const SUPERSEDED_INSTRUCTION_HASHES: Record<string, readonly string[]> = {
  // v1 — em-dash section labels, no ordering rule, no ⚠️ marker contract.
  // v2 — hard-coded Gmail tool names / query syntax (gmail-create-draft, in:sent).
  // v3 — prose digest with ⚠️ markers and manual importance ordering, replaced by the
  //   compose_briefing tool call and its REVIEW/TRIAGE/DRAFTS/PUBLISH/CLOSE structure.
  // v4 — per-account live searches and Gmail query syntax, replaced by the mirror
  //   read tools (list_threads/read_thread/list_sent_messages/list_drafts).
  // v5 — CLOSE prescribed a fixed sentence count, replaced by deferring to
  //   compose_briefing's own one-line closing contract.
  // v6 — read every noteworthy thread in full with no enrichment awareness,
  //   replaced by leaning on the enriched list_threads lines (gist/triage/
  //   deadline, needs_attention pass) and per-participant contact context.
  "Morning briefing": [
    "0998189fc3533bde38d61e1d508ec6e77378a3d73209cc8e5dbeb6f2d6511034",
    "eb629153709687168e1bd914a1bcf2f8ff2aedcbcc20003b232225b7c95eb59f",
    "e68d5f2bca75eec90583f9f9d39d1772b52a567e1f7408b343727bd44338c572",
    "faa799adad451168271033bbac979f2b140ef593d282e8a10c0fa39760f3e86a",
    "7c4621cb73762f3084063f3badbc68acd13cd32fcdbb636312ad5abb366290a9",
    "0b520b578e9c44272df6d60d6e7b36f3fa39b927ba610e6eba79ceb85c80d269",
  ],
};

function instructionHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Bring untouched built-in automations up to the current instruction text.
 * Idempotent by construction: once a row is rewritten its hash no longer
 * matches any superseded entry, so later boots are a no-op. Runs on every
 * start rather than behind a one-shot flag, which makes it self-healing.
 */
async function refreshUnmodifiedDefaults(): Promise<void> {
  const rows = await db
    .select({
      id: schema.automations.id,
      name: schema.automations.name,
      instruction: schema.automations.instruction,
    })
    .from(schema.automations);

  for (const row of rows) {
    const current = DEFAULT_AUTOMATIONS.find((a) => a.name === row.name);
    if (!current || row.instruction === current.instruction) continue;

    const superseded = SUPERSEDED_INSTRUCTION_HASHES[row.name] ?? [];
    if (!superseded.includes(instructionHash(row.instruction))) continue;

    await db
      .update(schema.automations)
      .set({ instruction: current.instruction })
      .where(eq(schema.automations.id, row.id));
    log.info({ automation: row.name }, "refreshed unmodified default instruction");
  }
}

/**
 * Seed the built-in automations on first run. Idempotent and conservative:
 *  - runs its body at most once ever, guarded by a settings flag;
 *  - only populates a brand-new (empty) automations table, so an existing
 *    install upgrading to this version is left untouched — just marked seeded
 *    so no duplicates are ever injected;
 *  - because the flag persists, deleting a default does not bring it back on
 *    the next restart.
 * Independently of that one-shot seed, every call refreshes built-in
 * automations whose instruction the user never edited — see
 * refreshUnmodifiedDefaults.
 * Call this before startScheduler() so seeded defaults get scheduled on boot.
 */
export async function seedDefaultAutomations(): Promise<void> {
  // Before the seed guard: existing installs are seeded already, and the
  // refresh is exactly what they need.
  await refreshUnmodifiedDefaults();

  if ((await getSetting(DEFAULTS_SEEDED_KEY)) === "true") return;

  const [existing] = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .limit(1);

  if (!existing) {
    const now = Date.now();
    await db.insert(schema.automations).values(
      DEFAULT_AUTOMATIONS.map((a, i) => ({
        id: randomUUID(),
        name: a.name,
        instruction: a.instruction,
        schedule: a.schedule,
        enabled: a.enabled,
        showInActivity: a.showInActivity,
        // Distinct, descending timestamps so the list order is deterministic:
        // the first entry is newest and thus leads the createdAt-desc feed.
        createdAt: new Date(now - i * 1000).toISOString(),
      })),
    );
    log.info({ count: DEFAULT_AUTOMATIONS.length }, "seeded default automation(s)");
  }

  await setSetting(DEFAULTS_SEEDED_KEY, "true");
}
