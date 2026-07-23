import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Voice input through the real app: with no STT-capable provider configured,
 * the route answers with a clear 400 instead of reaching any network endpoint.
 */

let appModule: typeof import("../../src/app.js");
let app: Awaited<ReturnType<typeof appModule.buildApp>>;

beforeAll(async () => {
  const scratch = await mkdtemp(join(tmpdir(), "marlen-stt-"));
  process.env.DATABASE_PATH = join(scratch, "test.db");
  process.env.AGENT_HOME_PATH = join(scratch, "home");
  // Provider auth falls back to ambient env keys; the dev machine's must not leak in.
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  delete process.env.MISTRAL_API_KEY;
  appModule = await import("../../src/app.js");
  app = await appModule.buildApp();
});

afterAll(async () => {
  await app?.close();
});

describe("voice input", () => {
  it("refuses transcription with a clear message when no STT provider is connected", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/stt",
      payload: { audio: Buffer.from("dummy").toString("base64"), mimeType: "audio/webm" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("OpenAI");
  });

  it("rejects an empty recording", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/stt",
      payload: { audio: "", mimeType: "audio/webm" },
    });
    expect(response.statusCode).toBe(400);
  });
});
