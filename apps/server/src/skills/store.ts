import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SKILL_MAX_LENGTH, type Skill } from "@trailin/shared";
import { env } from "../env.js";
import { emitServerEvent } from "../events.js";

/**
 * The skills folder: one markdown playbook per file, `<name>.md`. Line one is
 * the one-line description (listed in the agent's system prompt and on the
 * Knowledge page); everything after the first blank line is the instructions
 * the agent follows via skill_read. The folder is the source of truth — no
 * DB rows, no index — so the user can also edit skills in any editor; every
 * consumer (prompt index, tools, routes) re-reads it on demand.
 */

/** Filesystem- and prompt-safe skill identity: lowercase words joined by hyphens. */
export function slugifySkillName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function skillsDir(): string {
  return resolve(env.skillsPath);
}

/** Absolute path of one skill's file; null when the name doesn't survive slugging. */
function skillPath(name: string): string | null {
  const slug = slugifySkillName(name);
  return slug ? join(skillsDir(), `${slug}.md`) : null;
}

/** First line = description, rest (past the first blank line) = instructions. */
export function parseSkillFile(text: string): { description: string; instructions: string } {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const firstBreak = normalized.indexOf("\n");
  if (firstBreak === -1) return { description: normalized, instructions: "" };
  return {
    description: normalized.slice(0, firstBreak).trim(),
    instructions: normalized.slice(firstBreak).trim(),
  };
}

export function serializeSkillFile(description: string, instructions: string): string {
  return `${description.trim()}\n\n${instructions.trim()}\n`;
}

/** Every skill, alphabetized by name. A missing folder is an empty list, not an error. */
export async function listSkills(): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await readdir(skillsDir());
  } catch {
    return [];
  }
  const skills = await Promise.all(
    entries
      .filter((file) => file.endsWith(".md"))
      .map(async (file): Promise<Skill | null> => {
        const path = join(skillsDir(), file);
        try {
          const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
          const { description, instructions } = parseSkillFile(text);
          return {
            name: file.slice(0, -".md".length),
            description,
            instructions,
            updatedAt: info.mtime.toISOString(),
          };
        } catch {
          return null;
        }
      }),
  );
  return skills.filter((s): s is Skill => s !== null).sort((a, b) => a.name.localeCompare(b.name));
}

export async function readSkill(name: string): Promise<Skill | null> {
  const path = skillPath(name);
  if (!path) return null;
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    const { description, instructions } = parseSkillFile(text);
    return {
      name: slugifySkillName(name),
      description,
      instructions,
      updatedAt: info.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Create or overwrite one skill (same-name write updates it in place, like
 * library notes). Throws on an unusable name, an empty field, or an oversized
 * body — callers surface the message to the model or as a 400.
 */
export async function writeSkill(
  name: string,
  description: string,
  instructions: string,
): Promise<Skill> {
  const slug = slugifySkillName(name);
  if (!slug) throw new Error("skill name must contain letters or digits");
  const trimmedDescription = description.trim().replace(/\s+/g, " ");
  if (!trimmedDescription) throw new Error("skill description must not be empty");
  const trimmedInstructions = instructions.trim();
  if (!trimmedInstructions) throw new Error("skill instructions must not be empty");
  if (trimmedInstructions.length > SKILL_MAX_LENGTH) {
    throw new Error(`skill instructions must be at most ${SKILL_MAX_LENGTH} characters`);
  }

  await mkdir(skillsDir(), { recursive: true });
  const path = join(skillsDir(), `${slug}.md`);
  await writeFile(path, serializeSkillFile(trimmedDescription, trimmedInstructions), "utf8");
  emitServerEvent("skills");
  const info = await stat(path);
  return {
    name: slug,
    description: trimmedDescription,
    instructions: trimmedInstructions,
    updatedAt: info.mtime.toISOString(),
  };
}

/** Delete one skill's file; false when it didn't exist. */
export async function deleteSkill(name: string): Promise<boolean> {
  const path = skillPath(name);
  if (!path) return false;
  try {
    await rm(path);
  } catch {
    return false;
  }
  emitServerEvent("skills");
  return true;
}
