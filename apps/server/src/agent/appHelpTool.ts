import type { AgentTool } from "@earendil-works/pi-agent-core";
import { CHANGELOG, changelogNotes } from "@marlen/shared";
import { Type } from "@sinclair/typebox";
import { appVersion } from "../core/version.js";
import { getLanguageSetting } from "../db/settings.js";
import { prompts } from "./prompts.js";
import { textResult, tool } from "./toolkit.js";

/** Newest releases the changelog topic returns; the full list stays in Settings → About. */
const CHANGELOG_LIMIT = 10;

export const appHelpTool: AgentTool = tool({
  name: "app_help",
  label: "App help",
  description:
    `Authoritative documentation for Marlen, the app you run inside. Call it BEFORE answering ` +
    `any question about the app itself — what it can do, where a page or setting lives, how a ` +
    `feature behaves (topic "guide"), or which version is running and what changed in an ` +
    `update (topic "changelog") — and answer from what it returns, never from general ` +
    `knowledge about email apps or assistants.`,
  params: {
    topic: Type.Union([Type.Literal("guide"), Type.Literal("changelog")], {
      description:
        `"guide" for features, pages and settings; "changelog" for the running version and ` +
        `release notes.`,
    }),
  },
  execute: async ({ topic }) => {
    if (topic === "guide") {
      return textResult(`Running version: Marlen v${appVersion}\n\n${prompts.appGuide}`);
    }
    const language = (await getLanguageSetting()) ?? "de";
    const entries = CHANGELOG.slice(0, CHANGELOG_LIMIT).map(
      (entry) =>
        `v${entry.version} (${entry.date})\n` +
        changelogNotes(entry, language)
          .map((note) => `- ${note}`)
          .join("\n"),
    );
    const omitted = CHANGELOG.length - entries.length;
    return textResult(
      `Running version: Marlen v${appVersion}\n\n${entries.join("\n\n")}` +
        (omitted > 0
          ? `\n\n(${omitted} earlier release${omitted === 1 ? "" : "s"} omitted; the full ` +
            `changelog is in the app under Settings → About.)`
          : ""),
    );
  },
});
