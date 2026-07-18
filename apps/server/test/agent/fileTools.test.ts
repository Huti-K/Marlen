import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { fileToolsFor } from "../../src/agent/fileTools.js";

// The tools' cwd is the real home directory, so every path in here is
// absolute into a scratch dir — a relative path would touch actual files.
async function tempFolder(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), "trailin-files-")));
}

/** Runs a tool and flattens its text content. */
async function call(tools: AgentTool[], name: string, params: unknown): Promise<string> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} is not mounted`);
  const result = await tool.execute(`test-${name}`, params as never);
  return result.content
    .map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("");
}

describe("fileToolsFor", () => {
  it("mounts each tool group only for its armed grant", async () => {
    const names = async (read: boolean, write: boolean, bash: boolean) =>
      (await fileToolsFor({ read, write, bash })).map((t) => t.name);

    expect(await names(false, false, false)).toEqual([]);
    expect(await names(true, false, false)).toEqual([
      "file_ls",
      "file_find",
      "file_grep",
      "file_read",
    ]);
    expect(await names(false, true, false)).toEqual(["file_write", "file_edit"]);
    expect(await names(false, false, true)).toEqual(["file_bash"]);
  });

  it("reads any absolute path", async () => {
    const folder = await tempFolder();
    await writeFile(join(folder, "note.txt"), "anywhere\n");
    const tools = await fileToolsFor({ read: true, write: false, bash: false });
    expect(await call(tools, "file_read", { path: join(folder, "note.txt") })).toContain(
      "anywhere",
    );
  });

  it("writes any absolute path, creating parent folders", async () => {
    const folder = await tempFolder();
    const tools = await fileToolsFor({ read: false, write: true, bash: false });
    await call(tools, "file_write", { path: join(folder, "sub/out.md"), content: "written\n" });
    expect(await readFile(join(folder, "sub/out.md"), "utf8")).toBe("written\n");
  });

  it.skipIf(process.platform === "win32")(
    "bash starts in the home directory without secret-shaped env vars",
    async () => {
      process.env.TRAILIN_TEST_FAKE_API_KEY = "supersecret";
      try {
        const tools = await fileToolsFor({ read: false, write: false, bash: true });
        expect((await call(tools, "file_bash", { command: "pwd" })).trim()).toBe(
          await realpath(homedir()),
        );
        const env = await call(tools, "file_bash", {
          command: "env | grep TRAILIN_TEST_FAKE || echo ABSENT",
        });
        expect(env).toContain("ABSENT");
      } finally {
        delete process.env.TRAILIN_TEST_FAKE_API_KEY;
      }
    },
  );
});
