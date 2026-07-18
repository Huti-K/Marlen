import type { ConnectedAccount } from "@trailin/shared";
import { fetchAccountNameMap } from "../../agent/accounts.js";
import {
  getLatestAgentDraftBody,
  listUnlearnedSentDrafts,
  markDraftLearned,
} from "../../db/draftStore.js";
import { createMemory } from "../../db/memories.js";
import { resolveCheapModel } from "../../llm/registry.js";
import { moduleLogger } from "../../logger.js";
import { listAccounts } from "../../pipedream/connect.js";
import { collapseWhitespace } from "../../search/snippets.js";
import { errorMessage } from "../../utils/util.js";
import { getMailReadProvider, type MailReadProvider } from "../read/readProviders.js";
import { extractLessons } from "./extractLLM.js";

const log = moduleLogger("learn-extract");

/** One account's LLM call covers at most this many pending pairs a night; any excess waits for the next sweep. */
const MAX_PAIRS_PER_CALL = 10;

interface PendingPair {
  providerDraftId: string;
  draftBody: string;
  sentBody: string;
}

export type ExtractFn = (input: {
  pairs: Array<{ draftBody: string; sentBody: string }>;
  accountName: string;
}) => Promise<string[]>;

/** Real extraction: resolves a cheap model and asks it for style lessons over one account's pairs. */
async function defaultExtract(input: {
  pairs: Array<{ draftBody: string; sentBody: string }>;
  accountName: string;
}): Promise<string[]> {
  const model = await resolveCheapModel();
  return extractLessons(input.pairs, input.accountName, model);
}

/** Injectable seams: the lesson-extraction model call and the live account/read lookups. */
export interface ExtractSweepDeps {
  extract?: ExtractFn;
  listAccounts?: () => Promise<ConnectedAccount[]>;
  readerFor?: (app: string) => MailReadProvider | null;
}

export interface ExtractSweepResult {
  /** Sent-but-unlearned drafts pending when the sweep started. */
  pending: number;
  /** Pairs stamped learned without a lesson — the draft was sent unchanged. */
  identical: number;
  /** Edited pairs consumed by extraction this sweep. */
  learned: number;
  /** Style memories created from those pairs. */
  lessons: number;
}

/**
 * One sweep's worth of the nightly extraction pass: every sent-but-unlearned
 * agent_drafts snapshot whose sent message the provider can still serve is
 * diffed against its own latest agent-authored version, both sides
 * whitespace-normalized. The sent body comes live from the account's
 * MailReadProvider. A pair identical after normalizing needed no lesson and
 * is stamped learned_at directly; every other pair is batched per account (at
 * most MAX_PAIRS_PER_CALL) into one LLM call whose reported directives
 * become account-scoped memories. Unresolvable pairs (account disconnected,
 * no read driver, fetch failed) and any account whose LLM call fails are
 * left unstamped for a later night — dropping a lesson is fine, learning
 * the wrong one is not.
 */
export async function runExtractionSweep(deps: ExtractSweepDeps = {}): Promise<ExtractSweepResult> {
  const extract = deps.extract ?? defaultExtract;
  const readerFor = deps.readerFor ?? getMailReadProvider;

  const sentDrafts = await listUnlearnedSentDrafts();
  if (sentDrafts.length === 0) return { pending: 0, identical: 0, learned: 0, lessons: 0 };

  const accounts = await (deps.listAccounts ?? listAccounts)();
  const accountById = new Map(accounts.map((account) => [account.id, account]));

  const pendingByAccount = new Map<string, PendingPair[]>();
  let identical = 0;

  for (const draft of sentDrafts) {
    const account = accountById.get(draft.accountId);
    if (!account) continue; // disconnected — stays pending, recovers on reconnect
    const provider = readerFor(account.app);
    if (!provider) continue; // no read driver for this app — stays pending

    let sentBody: string | null;
    try {
      sentBody = await provider.getMessageBody(account, draft.sentMessageId);
    } catch (error) {
      log.warn(
        { err: errorMessage(error), accountId: draft.accountId },
        "sent-body fetch failed — pair stays pending for the next sweep",
      );
      continue;
    }
    if (sentBody === null) continue; // message gone at the provider — wait for a later night

    const draftBody = await getLatestAgentDraftBody(draft.accountId, draft.providerDraftId);
    if (draftBody === null) continue; // snapshot vanished or has no agent-authored version

    const strippedDraft = collapseWhitespace(draftBody);
    const strippedSent = collapseWhitespace(sentBody);
    if (strippedDraft === strippedSent) {
      await markDraftLearned(draft.accountId, draft.providerDraftId);
      identical++;
      continue;
    }

    const bucket = pendingByAccount.get(draft.accountId) ?? [];
    bucket.push({
      providerDraftId: draft.providerDraftId,
      draftBody: strippedDraft,
      sentBody: strippedSent,
    });
    pendingByAccount.set(draft.accountId, bucket);
  }

  let learned = 0;
  let lessons = 0;

  const names = pendingByAccount.size > 0 ? await fetchAccountNameMap() : new Map<string, string>();
  for (const [accountId, allPairs] of pendingByAccount) {
    const pairs = allPairs.slice(0, MAX_PAIRS_PER_CALL);
    try {
      const directives = await extract({
        pairs: pairs.map((pair) => ({ draftBody: pair.draftBody, sentBody: pair.sentBody })),
        accountName: names.get(accountId) ?? accountId,
      });
      for (const directive of directives) {
        try {
          await createMemory(directive, "agent", accountId);
          lessons++;
        } catch (error) {
          // Over-length or otherwise rejected by memory's own limits (including
          // "memory is full") — skip this one directive, not the whole batch.
          log.warn(
            { err: errorMessage(error), accountId },
            "style directive rejected by memory store",
          );
        }
      }
      for (const pair of pairs) {
        await markDraftLearned(accountId, pair.providerDraftId);
        learned++;
      }
    } catch (error) {
      log.warn(
        { err: errorMessage(error), accountId, pending: pairs.length },
        "nightly extraction failed for this account — pairs stay pending for the next sweep",
      );
    }
  }

  if (identical > 0 || learned > 0) {
    log.info({ identical, learned, lessons }, "nightly learning sweep done");
  }
  return { pending: sentDrafts.length, identical, learned, lessons };
}
