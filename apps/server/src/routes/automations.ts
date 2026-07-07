import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { desc, eq, isNull, or } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import {
  isValidCron,
  refreshSchedule,
  runAutomation,
  unschedule,
} from "../automations/scheduler.js";

interface AutomationBody {
  name: string;
  instruction: string;
  schedule: string;
  enabled?: boolean;
  showInActivity?: boolean;
}

export async function automationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/automations", async () => {
    return db.select().from(schema.automations).orderBy(desc(schema.automations.createdAt));
  });

  /** Cross-automation run feed for the Digest view. */
  app.get("/api/runs", async () => {
    return db
      .select({
        id: schema.automationRuns.id,
        automationId: schema.automationRuns.automationId,
        status: schema.automationRuns.status,
        result: schema.automationRuns.result,
        startedAt: schema.automationRuns.startedAt,
        finishedAt: schema.automationRuns.finishedAt,
        automationName: schema.automations.name,
      })
      .from(schema.automationRuns)
      .leftJoin(schema.automations, eq(schema.automations.id, schema.automationRuns.automationId))
      // Hide runs from automations the user has excluded from the activity feed.
      // leftJoin → a run whose automation was deleted has NULL columns; keep those.
      .where(or(isNull(schema.automations.showInActivity), eq(schema.automations.showInActivity, true)))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(100);
  });

  app.post<{ Body: AutomationBody }>("/api/automations", async (req, reply) => {
    const { name, instruction, schedule } = req.body ?? {};
    if (!name?.trim() || !instruction?.trim() || !schedule?.trim()) {
      return reply.code(400).send({ error: "name, instruction and schedule are required" });
    }
    if (!isValidCron(schedule.trim())) {
      return reply.code(400).send({ error: `invalid cron expression: ${schedule}` });
    }
    const automation = {
      id: randomUUID(),
      name: name.trim(),
      instruction: instruction.trim(),
      schedule: schedule.trim(),
      enabled: req.body.enabled ?? true,
      showInActivity: req.body.showInActivity ?? true,
      createdAt: new Date().toISOString(),
    };
    await db.insert(schema.automations).values(automation);
    await refreshSchedule(automation.id);
    return automation;
  });

  app.patch<{ Params: { id: string }; Body: Partial<AutomationBody> }>(
    "/api/automations/:id",
    async (req, reply) => {
      const updates: Record<string, unknown> = {};
      if (req.body.name !== undefined) updates.name = req.body.name.trim();
      if (req.body.instruction !== undefined) updates.instruction = req.body.instruction.trim();
      if (req.body.schedule !== undefined) {
        if (!isValidCron(req.body.schedule.trim())) {
          return reply.code(400).send({ error: `invalid cron expression: ${req.body.schedule}` });
        }
        updates.schedule = req.body.schedule.trim();
      }
      if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
      if (req.body.showInActivity !== undefined) updates.showInActivity = req.body.showInActivity;
      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "nothing to update" });
      }

      await db
        .update(schema.automations)
        .set(updates)
        .where(eq(schema.automations.id, req.params.id));
      await refreshSchedule(req.params.id);

      const [automation] = await db
        .select()
        .from(schema.automations)
        .where(eq(schema.automations.id, req.params.id));
      return automation ?? reply.code(404).send({ error: "not found" });
    },
  );

  app.delete<{ Params: { id: string } }>("/api/automations/:id", async (req) => {
    unschedule(req.params.id);
    await db.delete(schema.automations).where(eq(schema.automations.id, req.params.id));
    await db
      .delete(schema.automationRuns)
      .where(eq(schema.automationRuns.automationId, req.params.id));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/automations/:id/run", async (req, reply) => {
    // Fire and forget; the UI polls the runs list.
    runAutomation(req.params.id).catch((error) =>
      req.log.error(error, `manual run of ${req.params.id} failed`),
    );
    return reply.code(202).send({ ok: true });
  });

  app.get<{ Params: { id: string } }>("/api/automations/:id/runs", async (req) => {
    return db
      .select()
      .from(schema.automationRuns)
      .where(eq(schema.automationRuns.automationId, req.params.id))
      .orderBy(desc(schema.automationRuns.startedAt))
      .limit(20);
  });
}
