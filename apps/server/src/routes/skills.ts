import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { badRequest, notFound } from "../errors.js";
import { deleteSkill, listSkills, readSkill, writeSkill } from "../skills/store.js";
import { errorMessage } from "../utils/util.js";

const skillBody = Type.Object({
  description: Type.String(),
  instructions: Type.String(),
});

const nameParams = Type.Object({ name: Type.String() });

/**
 * The user's skills, managed on the Knowledge page. The store is the skills
 * folder itself (skills/store.ts), and the agent's prompt index is rebuilt
 * from it on every turn — an edit here reaches the next message on its own.
 * PUT is create-or-overwrite by name, matching the store's file-per-skill
 * model; there is no separate create endpoint.
 */
export const skillRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/skills", async () => listSkills());

  app.get("/api/skills/:name", { schema: { params: nameParams } }, async (req) => {
    const skill = await readSkill(req.params.name);
    if (!skill) throw notFound("skill not found");
    return skill;
  });

  app.put("/api/skills/:name", { schema: { params: nameParams, body: skillBody } }, async (req) => {
    // writeSkill validates the name and both fields (empty / too long);
    // surface those as 400s.
    try {
      return await writeSkill(req.params.name, req.body.description, req.body.instructions);
    } catch (error) {
      throw badRequest(errorMessage(error));
    }
  });

  app.delete("/api/skills/:name", { schema: { params: nameParams } }, async (req) => {
    const deleted = await deleteSkill(req.params.name);
    if (!deleted) throw notFound("skill not found");
    return { ok: true };
  });
};
