import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { env, pipedreamConfigured } from "./env.js";
import { chatRoutes } from "./routes/chat.js";
import { accountRoutes } from "./routes/accounts.js";
import { automationRoutes } from "./routes/automations.js";
import { llmRoutes } from "./routes/llm.js";
import { startScheduler } from "./automations/scheduler.js";
import { activeModelConfigured } from "./llm/registry.js";

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: "info" } });

  await app.register(cors, { origin: true });
  await app.register(accountRoutes);
  await app.register(chatRoutes);
  await app.register(automationRoutes);
  await app.register(llmRoutes);

  // When the web app has been built, serve it from the same process so a
  // single `pnpm start` works on a desktop machine or a host.
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith("/api/")) {
        reply.code(404).send({ error: "not found" });
        return;
      }
      reply.sendFile("index.html");
    });
  }

  await startScheduler();

  if (!(await activeModelConfigured())) {
    app.log.warn(
      "No LLM credentials yet — open Settings in the web UI to sign in with a subscription or save an API key.",
    );
  }
  if (!pipedreamConfigured()) {
    app.log.warn(
      "Pipedream Connect is not configured — Gmail/Outlook tools are unavailable (see .env.example).",
    );
  }

  await app.listen({ port: env.port, host: "0.0.0.0" });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
