import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { OutboundDraft } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { isTurnInFlight } from "../agent/turnRecorder.js";
import { badRequest, notFound } from "../core/errors.js";
import {
  getOutboundDraft,
  listOutboundDrafts,
  markOutboundStatus,
  updateOutboundDraft,
} from "../db/outboundStore.js";
import { getOutboundChannel } from "../services/outbound/registry.js";

const idParams = Type.Object({ id: Type.String() });

const patchBody = Type.Object({ body: Type.Optional(Type.String()) });

const listQuery = Type.Object({
  status: Type.Optional(
    Type.Union([Type.Literal("open"), Type.Literal("sent"), Type.Literal("discarded")]),
  ),
});

export const outboundRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    "/api/outbound",
    { schema: { querystring: listQuery } },
    async (req): Promise<OutboundDraft[]> => {
      // Same hold as email drafts (routes/drafts.ts): an open draft whose
      // conversation still has a turn running may yet be rewritten, so it is
      // withheld until the turn ends (endTurn re-emits "outbound").
      const drafts = await listOutboundDrafts(req.query.status);
      return drafts.filter(
        (draft) =>
          draft.status !== "open" || !draft.conversationId || !isTurnInFlight(draft.conversationId),
      );
    },
  );

  /**
   * Human-initiated send (the card's Send button): no permission is consulted,
   * the explicit click is the authorization, and the agent has no tool over
   * this route. Armed autosend goes through the channel at draft time instead.
   */
  app.post("/api/outbound/:id/send", { schema: { params: idParams } }, async (req) => {
    const draft = await getOutboundDraft(req.params.id);
    if (!draft) throw notFound("outbound draft not found");
    if (draft.status === "sent") return { ok: true };
    const channel = getOutboundChannel(draft.channel);
    if (!channel) throw badRequest(`unknown outbound channel: ${draft.channel}`);
    const { sentRef } = await channel.send(draft);
    await markOutboundStatus(draft.id, "sent", sentRef).catch((error: unknown) =>
      req.log.warn({ err: error }, "marking outbound draft sent failed"),
    );
    return { ok: true };
  });

  /** Hand-edits the body from Home. Only an unsent draft is still rewritable. */
  app.patch("/api/outbound/:id", { schema: { params: idParams, body: patchBody } }, async (req) => {
    const draft = await getOutboundDraft(req.params.id);
    if (!draft) throw notFound("outbound draft not found");
    if (draft.status !== "open") throw badRequest(`draft already ${draft.status}`);
    if (req.body.body !== undefined) await updateOutboundDraft(draft.id, { body: req.body.body });
    return { ok: true };
  });

  app.delete("/api/outbound/:id", { schema: { params: idParams } }, async (req) => {
    if (!(await markOutboundStatus(req.params.id, "discarded"))) {
      throw notFound("outbound draft not found");
    }
    return { ok: true };
  });

  app.get("/api/outbound/:id/status", { schema: { params: idParams } }, async (req) => {
    const draft = await getOutboundDraft(req.params.id);
    if (!draft) throw notFound("outbound draft not found");
    return { status: draft.status, ...(draft.sentRef ? { sentRef: draft.sentRef } : {}) };
  });
};
