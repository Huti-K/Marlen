import type { ConnectedAccount } from "@trailin/shared";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { getSetting, setSetting } from "../db/settings.js";
import { getMailReadProvider, type MailReadProvider } from "../email/read/readProviders.js";
import { moduleLogger } from "../logger.js";
import { listAccounts } from "../pipedream/connect.js";
import { JobLoop } from "../utils/jobs.js";
import { requestRun } from "./scheduler.js";

const log = moduleLogger("mailProbe");

/**
 * The new-mail probe: polls each connected account's newest inbox message and,
 * when a genuinely new one appears anywhere, runs every enabled automation
 * flagged runOnNewMail — the reactive complement to their cron schedule. Runs
 * go through scheduler.ts's requestRun, so a burst of mail lands as one run
 * plus at most one queued follow-up per automation, never a stack.
 */

/** Poll cadence. Tunable: each tick costs 1–2 proxied calls per connected account. */
const PROBE_INTERVAL_MS = 2 * 60_000;

const CURSORS_SETTING_KEY = "mailProbe.cursors";

/** The last-seen newest inbox message per account id, persisted across restarts. */
type ProbeCursors = Record<string, { id: string; date: string }>;

async function loadCursors(): Promise<ProbeCursors> {
  const raw = await getSetting(CURSORS_SETTING_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ProbeCursors;
  } catch {
    return {};
  }
}

/** Injectable seams: the provider/account lookups and the run entry point. */
export interface MailProbeDeps {
  readerFor?: (app: string) => MailReadProvider | null;
  listAccounts?: () => Promise<ConnectedAccount[]>;
  requestRun?: (automationId: string) => Promise<void>;
}

/**
 * One probe pass. Checks for flagged automations before touching any provider
 * (an idle tick with none flagged costs one local query), then per account:
 *
 * - No stored cursor: seed it from the observed newest without triggering, so
 *   a fresh boot or a newly connected account never fires a run storm over
 *   mail that was already there.
 * - Same id as the cursor: nothing new (date is null when the provider
 *   short-circuited on knownId; the stored entry already carries the date).
 * - Different id: new mail only when its date is strictly newer — the newest
 *   message being archived or deleted also changes the id, but only backwards
 *   in time. The cursor advances to the observed newest either way.
 *
 * A failing account is logged and keeps its cursor; the cursor map is written
 * once per pass, rebuilt from the live account list so entries for
 * disconnected accounts fall away. Any new mail triggers each flagged
 * automation once, fire-and-forget.
 */
export async function probeOnce(deps: MailProbeDeps = {}): Promise<void> {
  const flagged = await db
    .select({ id: schema.automations.id })
    .from(schema.automations)
    .where(and(eq(schema.automations.runOnNewMail, true), eq(schema.automations.enabled, true)));
  if (flagged.length === 0) return;

  const readerFor = deps.readerFor ?? getMailReadProvider;
  const accounts = await (deps.listAccounts ?? listAccounts)();
  const cursors = await loadCursors();
  const next: ProbeCursors = {};
  let sawNewMail = false;

  for (const account of accounts) {
    const provider = readerFor(account.app);
    if (!provider) continue;
    const cursor = cursors[account.id];

    let observed: { id: string; date: string | null } | null;
    try {
      observed = await provider.newestInbound(account, { knownId: cursor?.id });
    } catch (error) {
      log.warn(
        { err: error, accountId: account.id, app: account.app },
        "inbox probe failed — keeping this account's cursor until the next tick",
      );
      if (cursor) next[account.id] = cursor;
      continue;
    }

    if (!observed) {
      // Empty inbox: nothing to compare against; the stored cursor stays.
      if (cursor) next[account.id] = cursor;
      continue;
    }
    if (!cursor) {
      next[account.id] = { id: observed.id, date: observed.date ?? new Date().toISOString() };
      continue;
    }
    if (observed.id === cursor.id) {
      next[account.id] = cursor;
      continue;
    }
    if (observed.date !== null && observed.date > cursor.date) sawNewMail = true;
    next[account.id] = { id: observed.id, date: observed.date ?? cursor.date };
  }

  await setSetting(CURSORS_SETTING_KEY, JSON.stringify(next));

  if (!sawNewMail) return;
  const run = deps.requestRun ?? requestRun;
  for (const automation of flagged) {
    // One request per automation per burst; requestRun coalesces anything
    // that lands while a run is already in flight.
    run(automation.id).catch((error: unknown) =>
      log.error({ err: error, automationId: automation.id }, "new-mail run failed"),
    );
  }
}

const loop = new JobLoop({
  name: "mail-probe",
  run: () => probeOnce(),
  intervalMs: PROBE_INTERVAL_MS,
});

export function startMailProbe(): void {
  loop.start();
}

/** Stop the interval; a probe already running finishes on its own. */
export function stopMailProbe(): void {
  loop.stop();
}
