import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/** Imported dynamically after SKILLS_PATH points at a temp dir — env.ts reads it at import. */
let store: typeof import("../../src/skills/store.js");
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "trailin-skills-"));
  process.env.SKILLS_PATH = dir;
  store = await import("../../src/skills/store.js");
});

describe("slugifySkillName", () => {
  it("lowercases and hyphenates", () => {
    expect(store.slugifySkillName("Market Report!")).toBe("market-report");
    expect(store.slugifySkillName("  Wöchentlicher Überblick ")).toBe("wöchentlicher-überblick");
  });

  it("rejects names with no usable characters", () => {
    expect(store.slugifySkillName("!!! ???")).toBe("");
  });
});

describe("skill file format", () => {
  it("roundtrips description and instructions", () => {
    const text = store.serializeSkillFile("One line.", "Step 1.\n\nStep 2.");
    expect(store.parseSkillFile(text)).toEqual({
      description: "One line.",
      instructions: "Step 1.\n\nStep 2.",
    });
  });

  it("treats a single-line file as description only", () => {
    expect(store.parseSkillFile("Just a description\n")).toEqual({
      description: "Just a description",
      instructions: "",
    });
  });
});

describe("store", () => {
  it("writes, lists, reads, overwrites and deletes a skill", async () => {
    const saved = await store.writeSkill("Market Report", " Weekly numbers ", "Do the thing.");
    expect(saved.name).toBe("market-report");
    expect(saved.description).toBe("Weekly numbers");

    const files = await readdir(dir);
    expect(files).toContain("market-report.md");
    expect(await readFile(join(dir, "market-report.md"), "utf8")).toBe(
      "Weekly numbers\n\nDo the thing.\n",
    );

    const listed = await store.listSkills();
    expect(listed.map((s) => s.name)).toContain("market-report");

    // Same-name write overwrites in place — reads back the new body, and the
    // list holds one entry, not two.
    await store.writeSkill("market-report", "Weekly numbers", "Do it differently.");
    const read = await store.readSkill("Market Report");
    expect(read?.instructions).toBe("Do it differently.");
    expect((await store.listSkills()).filter((s) => s.name === "market-report")).toHaveLength(1);

    expect(await store.deleteSkill("market-report")).toBe(true);
    expect(await store.readSkill("market-report")).toBeNull();
    expect(await store.deleteSkill("market-report")).toBe(false);
  });

  it("rejects empty fields and unusable names", async () => {
    await expect(store.writeSkill("???", "d", "i")).rejects.toThrow(/name/);
    await expect(store.writeSkill("ok", "  ", "i")).rejects.toThrow(/description/);
    await expect(store.writeSkill("ok", "d", "  ")).rejects.toThrow(/instructions/);
  });
});
