import type { FastifyInstance } from "fastify";
import { isLanguage, SUPPORTED_LANGUAGES } from "@trailin/shared";
import {
  AGENT_INSTRUCTIONS_SETTING_KEY,
  EMAIL_WRITE_SETTING_KEY,
  getAccountColors,
  getAgentInstructionsSetting,
  getEmailWriteSetting,
  getLanguageSetting,
  LANGUAGE_SETTING_KEY,
  setAccountColors,
  setSetting,
} from "../db/settings.js";
import { resetSessions } from "../agent/emailAgent.js";

/** Standing instructions are capped like memory entries — a prompt fragment, not a document. */
const INSTRUCTIONS_MAX_LENGTH = 4000;

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings/language", async () => ({ language: await getLanguageSetting() }));

  app.put<{ Body: { language: string } }>("/api/settings/language", async (req, reply) => {
    const language = req.body?.language;
    if (!isLanguage(language)) {
      return reply
        .code(400)
        .send({ error: `language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}` });
    }
    await setSetting(LANGUAGE_SETTING_KEY, language);
    // The language lives in the system prompt, so drop in-memory agents —
    // new conversations (and scheduled runs) pick it up immediately.
    await resetSessions();
    return { language };
  });

  app.get("/api/settings/email-write", async () => ({
    allowWrite: await getEmailWriteSetting(),
  }));

  app.put<{ Body: { allowWrite: boolean } }>("/api/settings/email-write", async (req, reply) => {
    if (typeof req.body?.allowWrite !== "boolean") {
      return reply.code(400).send({ error: "allowWrite must be a boolean" });
    }
    await setSetting(EMAIL_WRITE_SETTING_KEY, String(req.body.allowWrite));
    // The guard decides which tools get registered — rebuild agent toolsets.
    await resetSessions();
    return { allowWrite: req.body.allowWrite };
  });

  app.get("/api/settings/instructions", async () => ({
    instructions: await getAgentInstructionsSetting(),
  }));

  app.put<{ Body: { instructions: string } }>("/api/settings/instructions", async (req, reply) => {
    const instructions = req.body?.instructions;
    if (typeof instructions !== "string") {
      return reply.code(400).send({ error: "instructions must be a string" });
    }
    const trimmed = instructions.trim();
    if (trimmed.length > INSTRUCTIONS_MAX_LENGTH) {
      return reply
        .code(400)
        .send({ error: `instructions must be at most ${INSTRUCTIONS_MAX_LENGTH} characters` });
    }
    await setSetting(AGENT_INSTRUCTIONS_SETTING_KEY, trimmed);
    // Instructions live in the system prompt, so drop in-memory agents — new
    // conversations (and scheduled runs) pick them up immediately.
    await resetSessions();
    return { instructions: trimmed };
  });

  // ---- Account colors ----

  app.get("/api/settings/account-colors", async () => ({
    colors: await getAccountColors(),
  }));

  app.put<{ Body: { colors: import("@trailin/shared").AccountColor[] } }>(
    "/api/settings/account-colors",
    async (req, reply) => {
      const colors = req.body?.colors;
      if (!Array.isArray(colors)) {
        return reply.code(400).send({ error: "colors must be an array" });
      }
      // Basic validation: each entry needs accountId and hex
      for (const c of colors) {
        if (!c.accountId || !c.hex) {
          return reply.code(400).send({ error: "each color must have accountId and hex" });
        }
      }
      await setAccountColors(colors);
      return { colors };
    },
  );
}
