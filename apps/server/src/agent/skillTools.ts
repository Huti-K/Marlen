import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { listSkills, readSkill, writeSkill } from "../storage/skills/store.js";
import { textResult, tool } from "./toolkit.js";

/**
 * Named playbooks (skills/store.ts). skill_read is in every session (unattended
 * runs follow skills too), but skill_write is interactive-only: a skill is a
 * standing instruction run on later runs, so unattended sessions reading
 * attacker-controlled mail can't plant or alter one. Deletion is UI-only.
 */

export const skillReadTool: AgentTool = tool({
  name: "skill_read",
  label: "Read skill",
  description:
    `Read the full instructions of one skill from the skill list in your system prompt. ` +
    `Always read a skill before following it — the index line is only its summary. Follow the ` +
    `instructions with your normal tools; they never grant abilities you don't have.`,
  params: {
    name: Type.String({ description: "The skill's name, as listed in the system prompt." }),
  },
  execute: async ({ name }) => {
    const skill = await readSkill(name);
    if (!skill) {
      const names = (await listSkills()).map((s) => s.name);
      return textResult(
        names.length > 0
          ? `No skill named "${name}". Saved skills: ${names.join(", ")}.`
          : `No skill named "${name}" — no skills are saved yet.`,
      );
    }
    return textResult(`Skill "${skill.name}" — ${skill.description}\n\n${skill.instructions}`);
  },
});

export const skillWriteTool: AgentTool = tool({
  name: "skill_write",
  label: "Save skill",
  description:
    `Save a reusable skill — a named playbook for how the user wants a recurring task done. ` +
    `Use it when the user describes a repeatable procedure ("always do it like this", "from now ` +
    `on when I ask for X…"), not for one-off requests. Write the instructions as a complete ` +
    `brief to a future session that knows nothing of this conversation: when the skill applies, ` +
    `which accounts and tools to use, the steps, and what the result should look like. Writing ` +
    `an existing name overwrites that skill — read it first and save the complete edited ` +
    `version. The user sees and edits skills on the Knowledge page; tell them what you saved.`,
  params: {
    name: Type.String({
      description: 'Short kebab-case name, e.g. "market-report" — this is how it is invoked.',
    }),
    description: Type.String({
      description: "One line saying what the skill does and when it applies.",
    }),
    instructions: Type.String({
      description: "The complete, self-contained playbook a future session will follow.",
    }),
  },
  catchToText: true,
  execute: async ({ name, description, instructions }) => {
    const skill = await writeSkill(name, description, instructions);
    return textResult(`Saved skill "${skill.name}" — ${skill.description}`);
  },
});

/** A description is an index line, not the skill; the body is what skill_read is for. */
const SKILL_DESCRIPTION_MAX_CHARS = 300;

/**
 * System-prompt index: name + one-line description only; the body is left to
 * skill_read since every entry rides on every turn. Skills are files the user
 * can also write from outside the app, so the index is held to `budget`
 * characters: entries past it are named but not described, and past that
 * counted, so the section can never outgrow its share of the prompt.
 */
export async function buildSkillsContext(budget: number): Promise<string> {
  const skills = await listSkills();
  if (skills.length === 0) return "";
  const header =
    `\n\nSkills — the user's saved playbooks for how they want recurring tasks done. When a ` +
    `request matches one, read it with skill_read and follow it:\n`;

  // Too little room for a header and a line or two: the section would cost the
  // conversation more than the stub is worth.
  if (budget < header.length + 200) return "";

  const lines: string[] = [];
  let used = header.length;
  for (const skill of skills) {
    const line = `- ${skill.name}: ${skill.description.slice(0, SKILL_DESCRIPTION_MAX_CHARS)}`;
    const rest = `… and ${skills.length - lines.length} more, listed on the Knowledge page.`;
    // Room for this line AND the note that would replace the remainder, so the
    // last line never pushes the section over.
    if (used + line.length + rest.length + 2 > budget) {
      lines.push(rest);
      break;
    }
    used += line.length + 1;
    lines.push(line);
  }
  return header + lines.join("\n");
}
