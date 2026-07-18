import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { listSkills, readSkill, writeSkill } from "../skills/store.js";
import { textResult, tool } from "./toolkit.js";

/**
 * The agent's surface over the user's skills (skills/store.ts): named
 * playbooks that say how the user wants a recurring task done. skill_read is
 * mounted in every session — unattended runs follow skills too ("Follow the
 * skill 'x'" automations) — but skill_write is interactive-only: a skill is a
 * standing instruction executed on later runs, so unattended sessions reading
 * attacker-controlled mail must never be able to plant or alter one (the same
 * rule as memory writes and automation management). Deletion is UI-only, like
 * library documents.
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

/**
 * The system-prompt index of saved skills: name + one-line description each,
 * with the body deliberately left to skill_read — descriptions must stay
 * cheap because every entry rides along on every turn. Returns "" when no
 * skills exist.
 */
export async function buildSkillsContext(): Promise<string> {
  const skills = await listSkills();
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return (
    `\n\nSkills — the user's saved playbooks for how they want recurring tasks done. When a ` +
    `request matches one, read it with skill_read and follow it:\n${lines.join("\n")}`
  );
}
