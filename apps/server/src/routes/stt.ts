import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { SttResult } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { badRequest } from "../core/errors.js";
import { transcribe } from "../services/transcribe.js";

// Base64 inflates 4/3, so this admits ~11MB of audio — well past any voice memo.
const BODY_LIMIT = 15 * 1024 * 1024;

const sttBody = Type.Object({
  audio: Type.String(),
  mimeType: Type.String(),
  /** ISO-639-1 hint from the app language; improves recognition, never required. */
  language: Type.Optional(Type.String()),
});

export const sttRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.post(
    "/api/stt",
    { schema: { body: sttBody }, bodyLimit: BODY_LIMIT },
    async (req): Promise<SttResult> => {
      const audio = Buffer.from(req.body.audio, "base64");
      if (audio.length === 0) throw badRequest("audio is required");
      return { text: await transcribe(audio, req.body.mimeType, req.body.language) };
    },
  );
};
