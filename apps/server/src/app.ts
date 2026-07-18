import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
// Populate the provider registries (drafts, attachments, mail read) once for
// the whole process — routes, agent tools, and background loops all resolve
// providers from them, and this is the single place the register modules are
// pulled in.
import "./email/registerProviders.js";
import "./email/registerAttachmentProviders.js";
import "./email/read/registerReadProviders.js";
import { closeDb } from "./db/index.js";
import { env } from "./env.js";
import { type ErrorResponse, registerErrorHandler } from "./errors.js";
import { isAllowedHost, isLoopbackOrigin } from "./hostGuard.js";
import { logger } from "./logger.js";
import { accountRoutes } from "./routes/accounts.js";
import { automationRoutes } from "./routes/automations.js";
import { backupRoutes } from "./routes/backup.js";
import { chatRoutes } from "./routes/chat.js";
import { draftRoutes } from "./routes/drafts.js";
import { eventRoutes } from "./routes/events.js";
import { leadsRoutes } from "./routes/leads.js";
import { learnRoutes } from "./routes/learn.js";
import { libraryRoutes } from "./routes/library.js";
import { llmRoutes } from "./routes/llm.js";
import { mailRoutes } from "./routes/mail.js";
import { memoryRoutes } from "./routes/memories.js";
import { onOfficeRoutes } from "./routes/onoffice.js";
import { pipedreamRoutes } from "./routes/pipedream.js";
import { searchRoutes } from "./routes/search.js";
import { settingsRoutes } from "./routes/settings.js";
import { skillRoutes } from "./routes/skills.js";
import { whatsAppRoutes } from "./routes/whatsapp.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Build the fully configured Fastify instance: error handling, CORS, host
 * guard, every route plugin, and static serving of the built web app.
 * Everything except background services and listening — index.ts starts
 * those around it, and tests drive this instance directly via app.inject()
 * against a scratch DATABASE_PATH.
 */
export async function buildApp(): Promise<FastifyInstance> {
  // Share the process-wide logger rather than letting Fastify build its own,
  // so `req.log` and the scheduler/MCP loggers agree on level and redaction.
  // Typed as FastifyBaseLogger at the boundary: handing Fastify a pino.Logger
  // narrows the inferred FastifyInstance and every plugin then mismatches it.
  const loggerInstance: FastifyBaseLogger = logger;
  // maxParamLength must exceed the longest provider id that rides in a path
  // param: Outlook Graph message/conversation ids run ~140-170 chars (and
  // immutable ids longer), while the router's 100-char default makes such
  // routes miss entirely — a bare 404 with no handler ever running.
  const app = Fastify({ loggerInstance, routerOptions: { maxParamLength: 512 } });
  registerErrorHandler(app);

  // The database handle follows the app's lifecycle: close() releases it so
  // the process holds no SQLite lock afterwards, and a test worker can build
  // a fresh app against a fresh scratch file.
  app.addHook("onClose", async () => {
    closeDb();
  });

  // No auth on this API (local-first, single-user), so CORS is the only
  // thing stopping an arbitrary website from reading/mutating it via the
  // browser — reflect only loopback origins (any port; the same set the host
  // guard treats as loopback), never `true`.
  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, !origin || isLoopbackOrigin(origin));
    },
  });

  // DNS-rebinding defense: CORS above only looks at Origin, which a rebound
  // page never has to send — the Host header is what's left to catch it.
  app.addHook("onRequest", async (req, reply) => {
    if (!isAllowedHost(req.headers.host, env.host)) {
      const body: ErrorResponse = { error: "host not allowed", requestId: String(req.id) };
      // Returning the reply is what marks the hook as having handled the
      // request — the send alone only works while it stays synchronous.
      return reply.code(403).send(body);
    }
  });

  await app.register(accountRoutes);
  await app.register(chatRoutes);
  await app.register(automationRoutes);
  await app.register(llmRoutes);
  await app.register(pipedreamRoutes);
  await app.register(onOfficeRoutes);
  await app.register(whatsAppRoutes);
  await app.register(settingsRoutes);
  await app.register(draftRoutes);
  await app.register(memoryRoutes);
  await app.register(skillRoutes);
  await app.register(leadsRoutes);
  await app.register(learnRoutes);
  await app.register(libraryRoutes);
  await app.register(mailRoutes);
  await app.register(eventRoutes);
  await app.register(searchRoutes);
  await app.register(backupRoutes);

  // 404s answer in the API's `{ error }` shape instead of Fastify's default
  // `{ statusCode, error, message }`.
  const apiNotFound = (req: FastifyRequest, reply: FastifyReply): void => {
    const body: ErrorResponse = { error: "not found", requestId: String(req.id) };
    reply.code(404).send(body);
  };

  // When the web app has been built, serve it from the same process so a
  // single `pnpm start` works on a desktop machine or a host; anything that
  // isn't an API route falls through to the SPA. In dev the web app is
  // served by Vite instead.
  const webDist = env.webDistPath ?? resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) apiNotFound(req, reply);
      else reply.sendFile("index.html");
    });
  } else {
    app.setNotFoundHandler(apiNotFound);
  }

  return app;
}
