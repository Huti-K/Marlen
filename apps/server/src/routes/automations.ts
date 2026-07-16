import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { parseStoredCards } from "../agent/cards.js";
import { createAutomation, deleteAutomation, updateAutomation } from "../automations/manage.js";
import {
  findMissedAutomations,
  getNextRunAt,
  runAutomation,
  runMissedAutomations,
} from "../automations/scheduler.js";
import { decideSuggestion, listPendingSuggestions } from "../db/automationSuggestions.js";
import { db, schema } from "../db/index.js";
import { likeContains, likePattern } from "../db/like.js";
import { notFound, requireRow } from "../errors.js";

const runsQuery = Type.Object({
  q: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  offset: Type.Optional(Type.Integer({ minimum: 0 })),
});

const idParams = Type.Object({ id: Type.String() });

const automationBody = Type.Object({
  name: Type.String(),
  instruction: Type.String(),
  schedule: Type.String(),
  enabled: Type.Optional(Type.Boolean()),
  showInActivity: Type.Optional(Type.Boolean()),
  pinned: Type.Optional(Type.Boolean()),
});

const automationPatchBody = Type.Object({
  name: Type.Optional(Type.String()),
  instruction: Type.Optional(Type.String()),
  schedule: Type.Optional(Type.String()),
  enabled: Type.Optional(Type.Boolean()),
  showInActivity: Type.Optional(Type.Boolean()),
  pinned: Type.Optional(Type.Boolean()),
});

/** Join condition linking a run to its automation, shared by every runs query and its count. */
const runToAutomation = eq(schema.automations.id, schema.automationRuns.automationId);

/**
 * The run+automation-name projection every runs list reads from — a fresh
 * query builder each call, since a caller chains its own where/orderBy/limit
 * onto it. leftJoin keeps a run whose automation was deleted in the result,
 * with a null automationName, rather than dropping it.
 */
function runsSelectBase() {
  return db
    .select({
      id: schema.automationRuns.id,
      automationId: schema.automationRuns.automationId,
      status: schema.automationRuns.status,
      result: schema.automationRuns.result,
      cards: schema.automationRuns.cards,
      startedAt: schema.automationRuns.startedAt,
      finishedAt: schema.automationRuns.finishedAt,
      automationName: schema.automations.name,
    })
    .from(schema.automationRuns)
    .leftJoin(schema.automations, runToAutomation);
}

/** The cards column is a JSON blob internally; every run the API ships carries it parsed. */
function toRunDto<T extends { cards: string | null }>(
  row: T,
): Omit<T, "cards"> & { cards: ReturnType<typeof parseStoredCards> } {
  const { cards, ...rest } = row;
  return { ...rest, cards: parseStoredCards(cards) };
}

export const automationRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/automations", async () => {
    const rows = await db
      .select()
      .from(schema.automations)
      .orderBy(desc(schema.automations.createdAt));
    return rows.map((row) => ({ ...row, nextRunAt: getNextRunAt(row.id) }));
  });

  /** Cross-automation run feed for the Home activity section. */
  app.get("/api/runs", { schema: { querystring: runsQuery } }, async (req) => {
    const q = req.query.q?.trim();
    const limit = Math.min(req.query.limit ?? 30, 100);
    const offset = req.query.offset ?? 0;

    // Hide runs from automations the user has excluded from the activity feed.
    // leftJoin → a run whose automation was deleted has NULL columns; keep those.
    const visible = or(
      isNull(schema.automations.showInActivity),
      eq(schema.automations.showInActivity, true),
    );
    // SQLite's LIKE is case-insensitive for ASCII by default, which covers the
    // digest text this searches over.
    const pattern = q ? likeContains(q) : undefined;
    const where = pattern
      ? and(
          visible,
          or(
            likePattern(schema.automationRuns.result, pattern),
            likePattern(schema.automations.name, pattern),
          ),
        )
      : visible;

    const rows = await runsSelectBase()
      .where(where)
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(limit)
      .offset(offset);
    const items = rows.map(toRunDto);

    const totalQuery = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.automationRuns)
      .leftJoin(schema.automations, runToAutomation);
    const [totalRow] = await totalQuery.where(where);

    return { items, total: Number(totalRow?.count ?? 0) };
  });

  /**
   * The pinned automation's latest successful run, for the Home page lead
   * card. Deliberately bypasses both filters /api/runs applies: it is not
   * hidden by showInActivity (pinning is an explicit, stronger signal), and
   * it is not subject to that endpoint's pagination limit, so an old pinned
   * run can never fall out of view.
   */
  app.get("/api/runs/pinned", async () => {
    const [automation] = await db
      .select()
      .from(schema.automations)
      .where(eq(schema.automations.pinned, true));
    if (!automation) return { run: null, automation: null };

    const [run] = await runsSelectBase()
      .where(
        and(
          eq(schema.automationRuns.automationId, automation.id),
          eq(schema.automationRuns.status, "success"),
          ne(schema.automationRuns.result, ""),
        ),
      )
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(1);

    return {
      run: run ? toRunDto(run) : null,
      automation: { ...automation, nextRunAt: getNextRunAt(automation.id) },
    };
  });

  /**
   * Automations whose latest scheduled slot elapsed without a covering run
   * (see automations/scheduler.ts). Empty once boot catch-up has run them, so
   * the Home page shows its "run missed" button only when catch-up couldn't.
   */
  app.get("/api/runs/missed", async () => {
    return { items: await findMissedAutomations() };
  });

  /** Run every automation with an uncovered past slot now — the Home button's
   *  manual fallback when boot catch-up didn't (or couldn't). */
  app.post("/api/runs/catch-up", async (_req, reply) => {
    const started = await runMissedAutomations();
    return reply.code(202).send({ started });
  });

  /** Pending proposals from the suggestion sweep, for the Automations page's accept/dismiss queue. */
  app.get("/api/automations/suggestions", async () => listPendingSuggestions());

  /** Accept a suggestion: create the automation it proposes, then retire the suggestion. */
  app.post(
    "/api/automations/suggestions/:id/accept",
    { schema: { params: idParams } },
    async (req) => {
      const suggestions = await listPendingSuggestions();
      const suggestion = suggestions.find((s) => s.id === req.params.id);
      if (!suggestion) throw notFound("no pending suggestion with this id");
      const automation = await createAutomation({
        name: suggestion.name,
        instruction: suggestion.instruction,
        schedule: suggestion.schedule,
      });
      // Only after the automation exists — a failed create leaves the
      // suggestion pending instead of silently swallowing the proposal.
      await decideSuggestion(req.params.id, "accepted");
      return automation;
    },
  );

  app.post(
    "/api/automations/suggestions/:id/dismiss",
    { schema: { params: idParams } },
    async (req) => {
      const decided = await decideSuggestion(req.params.id, "dismissed");
      if (!decided) throw notFound("no pending suggestion with this id");
      return { ok: true };
    },
  );

  app.post("/api/automations", { schema: { body: automationBody } }, async (req) => {
    return createAutomation(req.body);
  });

  app.patch(
    "/api/automations/:id",
    { schema: { params: idParams, body: automationPatchBody } },
    async (req) => {
      return updateAutomation(req.params.id, req.body);
    },
  );

  app.delete("/api/automations/:id", { schema: { params: idParams } }, async (req) => {
    await deleteAutomation(req.params.id);
    return { ok: true };
  });

  app.post("/api/automations/:id/run", { schema: { params: idParams } }, async (req, reply) => {
    await requireRow(
      db
        .select({ id: schema.automations.id })
        .from(schema.automations)
        .where(eq(schema.automations.id, req.params.id)),
      "not found",
    );
    // Fire and forget; the UI polls the runs list.
    runAutomation(req.params.id, { manual: true }).catch((error) =>
      req.log.error(error, `manual run of ${req.params.id} failed`),
    );
    return reply.code(202).send({ ok: true });
  });

  app.get("/api/automations/:id/runs", { schema: { params: idParams } }, async (req) => {
    const rows = await db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.automationId, req.params.id))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(20);
    return rows.map(toRunDto);
  });
};
