import type { ConnectedAccount } from "@trailin/shared";
import {
  getLatestDraftBody,
  listOpenDraftSnapshots,
  markDraftStatus,
  type OpenDraftSnapshot,
} from "../../db/draftStore.js";
import { emitServerEvent } from "../../events.js";
import { resolveCheapModel } from "../../llm/registry.js";
import { moduleLogger } from "../../logger.js";
import { listAccounts } from "../../pipedream/connect.js";
import {
  getMailReadProvider,
  type MailReadProvider,
  type SentMessage,
} from "../read/readProviders.js";
// Side-effect import: populates the MailReadProvider registry.
import "../read/registerReadProviders.js";
import { normalizeAddressSet, normalizeSubject, sameAddressSet } from "./addressSubject.js";
import { resolveTiebreak } from "./matchLLM.js";

const log = moduleLogger("learn-match");

/** Standalone drafts only match sent mail within this window of their creation. */
const STANDALONE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * One sweep's worth of the draft-vs-sent matcher: for every open agent_drafts
 * snapshot, look for the mail it turned into. Candidates come live from the
 * account's MailReadProvider — one listSentSince call per account per sweep,
 * anchored at that account's oldest open draft; accounts that are gone, have
 * no read driver, or fail the fetch are skipped without aborting the sweep.
 *
 * Deterministic rules, in order:
 *  - Reply drafts (snapshot has a threadId): any candidate sharing that
 *    provider thread id is the match — the earliest one after creation when
 *    several exist, no LLM involved.
 *  - Standalone drafts: candidates whose recipient set equals the snapshot's
 *    `to` set and whose subject matches ignoring reply prefixes, case, and
 *    whitespace, within STANDALONE_WINDOW_MS of creation. Exactly one such
 *    candidate is the match; zero leaves the draft open; more than one is
 *    genuinely ambiguous and falls to the tiebreak seam.
 *
 * A draft with zero candidates at all (nothing sent from the account since
 * it was created) is skipped without touching the match rules.
 */

export type TiebreakFn = (input: {
  latestBody: string;
  candidates: Array<{ providerMessageId: string; body: string }>;
}) => Promise<string | null>;

/** Injectable seams: the tiebreak model call and the live account/read lookups. */
export interface MatchSweepDeps {
  tiebreak?: TiebreakFn;
  listAccounts?: () => Promise<ConnectedAccount[]>;
  readerFor?: (app: string) => MailReadProvider | null;
}

/** Real tiebreak: resolves a cheap model and asks it to pick the matching candidate. May throw
 *  (unconfigured model, network failure, timeout, a malformed report) — runMatchSweep's call site
 *  is what guarantees a failure here is treated exactly like an explicit "none". */
async function defaultTiebreak(input: {
  latestBody: string;
  candidates: Array<{ providerMessageId: string; body: string }>;
}): Promise<string | null> {
  const model = await resolveCheapModel();
  return resolveTiebreak(input.latestBody, input.candidates, model);
}

/** The earliest candidate in the same thread, or null when none share it. Relies on listSentSince's ascending order. */
function threadMatch(candidates: SentMessage[], threadId: string): SentMessage | null {
  return candidates.find((candidate) => candidate.providerThreadId === threadId) ?? null;
}

/** Every candidate whose recipients and subject match the draft, within the standalone window. */
function standaloneMatches(
  candidates: SentMessage[],
  draft: { to: string[]; subject: string; createdAt: string },
): SentMessage[] {
  const wantAddrs = normalizeAddressSet(draft.to);
  const wantSubject = normalizeSubject(draft.subject);
  const deadline = new Date(draft.createdAt).getTime() + STANDALONE_WINDOW_MS;
  return candidates.filter((candidate) => {
    if (new Date(candidate.date).getTime() > deadline) return false;
    if (normalizeSubject(candidate.subject) !== wantSubject) return false;
    return sameAddressSet(normalizeAddressSet(candidate.to), wantAddrs);
  });
}

/** Oldest createdAt in the group — the listSentSince anchor covering every draft at once. */
function oldestCreatedAt(drafts: OpenDraftSnapshot[]): string {
  return drafts.reduce(
    (oldest, draft) => (draft.createdAt < oldest ? draft.createdAt : oldest),
    drafts[0]?.createdAt ?? new Date().toISOString(),
  );
}

async function matchDraft(
  draft: OpenDraftSnapshot,
  candidates: SentMessage[],
  tiebreak: TiebreakFn,
): Promise<boolean> {
  if (candidates.length === 0) return false;

  if (draft.threadId) {
    const hit = threadMatch(candidates, draft.threadId);
    if (!hit) return false;
    await markDraftStatus(draft.accountId, draft.providerDraftId, "sent", hit.providerMessageId);
    return true;
  }

  const hits = standaloneMatches(candidates, draft);
  if (hits.length === 0) return false;

  if (hits.length === 1 && hits[0]) {
    await markDraftStatus(
      draft.accountId,
      draft.providerDraftId,
      "sent",
      hits[0].providerMessageId,
    );
    return true;
  }

  // Genuinely ambiguous: several sends share recipients and subject within
  // the window. No match beats a wrong match, so anything but a confident
  // pick from the tiebreak — including the tiebreak itself failing — leaves
  // the draft open for a later sweep, and must not abort the rest of this
  // sweep's remaining drafts.
  const latestBody = await getLatestDraftBody(draft.accountId, draft.providerDraftId);
  if (!latestBody) return false;
  let matchedId: string | null;
  try {
    matchedId = await tiebreak({
      latestBody,
      candidates: hits.map((hit) => ({
        providerMessageId: hit.providerMessageId,
        body: hit.bodyText,
      })),
    });
  } catch (error) {
    log.warn(
      { err: error, accountId: draft.accountId, providerDraftId: draft.providerDraftId },
      "sent-mail tiebreak failed — leaving the draft open",
    );
    return false;
  }
  if (!matchedId) return false;
  const hit = hits.find((candidate) => candidate.providerMessageId === matchedId);
  if (!hit) return false; // the model named an id outside the candidate set — treat as no match
  await markDraftStatus(draft.accountId, draft.providerDraftId, "sent", hit.providerMessageId);
  return true;
}

export interface MatchSweepResult {
  /** Drafts this sweep matched to a sent message. */
  matched: number;
}

export async function runMatchSweep(deps: MatchSweepDeps = {}): Promise<MatchSweepResult> {
  const tiebreak = deps.tiebreak ?? defaultTiebreak;
  const readerFor = deps.readerFor ?? getMailReadProvider;

  const openDrafts = await listOpenDraftSnapshots();
  if (openDrafts.length === 0) return { matched: 0 };

  const byAccount = new Map<string, OpenDraftSnapshot[]>();
  for (const draft of openDrafts) {
    const bucket = byAccount.get(draft.accountId) ?? [];
    bucket.push(draft);
    byAccount.set(draft.accountId, bucket);
  }

  const accounts = await (deps.listAccounts ?? listAccounts)();
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  let matched = 0;
  for (const [accountId, drafts] of byAccount) {
    const account = accountById.get(accountId);
    if (!account) {
      log.debug({ accountId }, "open drafts for a disconnected account — skipping");
      continue;
    }
    const provider = readerFor(account.app);
    if (!provider) {
      log.debug({ accountId, app: account.app }, "no mail read driver — skipping match sweep");
      continue;
    }

    let candidates: SentMessage[];
    try {
      candidates = await provider.listSentSince(account, oldestCreatedAt(drafts));
    } catch (error) {
      log.warn(
        { err: error, accountId, app: account.app },
        "sent-mail fetch failed — skipping this account until the next sweep",
      );
      continue;
    }

    for (const draft of drafts) {
      const afterCreation = candidates.filter((candidate) => candidate.date > draft.createdAt);
      if (await matchDraft(draft, afterCreation, tiebreak)) matched++;
    }
  }

  if (matched > 0) {
    log.info({ matched }, "draft-vs-sent match sweep done");
    emitServerEvent("drafts");
  }
  return { matched };
}
