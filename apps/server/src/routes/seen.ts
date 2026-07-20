import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { SeenState } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { getSeenState, markAllSeen, markSeen } from "../db/seenStore.js";

const seenBody = Type.Object({
  /** Item keys to mark; omitted or empty with all=true marks everything seen. */
  keys: Type.Optional(Type.Array(Type.String())),
  all: Type.Optional(Type.Boolean()),
});

export const seenRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get("/api/seen", async (): Promise<SeenState> => getSeenState());

  app.post("/api/seen", { schema: { body: seenBody } }, async (req): Promise<SeenState> => {
    if (req.body.all) await markAllSeen();
    else await markSeen(req.body.keys ?? []);
    return getSeenState();
  });
};
