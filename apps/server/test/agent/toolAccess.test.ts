import { describe, expect, it } from "vitest";
import {
  type ActionGrants,
  NO_GRANTS,
  registeredCategory,
  sessionGrants,
} from "../../src/agent/toolAccess.js";

/**
 * The grant policy is the line between "may read my mail" and "may empty it",
 * and it is enforced by never registering the tool at all. A regression is
 * therefore invisible until the assistant does something the user never armed,
 * so the two rules that matter are pinned here: an armed send grant holds in
 * unattended runs, everything mutating does not.
 */

const ALL_GRANTS: ActionGrants = { write: true, send: true, delete: true };

const registers = (mcpToolName: string, granted: ActionGrants): boolean =>
  registeredCategory(mcpToolName, granted) !== null;

describe("account grant policy", () => {
  it("reads and drafts need no grant; attachment bytes are never a tool", () => {
    for (const interactive of [true, false]) {
      const granted = sessionGrants(NO_GRANTS, interactive);
      expect(registers("gmail-find-email", granted)).toBe(true);
      expect(registers("slack-list-conversations", granted)).toBe(true);
      expect(registers("microsoft_outlook-create-draft", granted)).toBe(true);
      expect(registers("gmail-download-attachment", granted)).toBe(false);
    }
  });

  it("an armed send grant reaches unattended runs; creating, changing and deleting do not", () => {
    const unattended = sessionGrants(ALL_GRANTS, false);
    expect(registers("gmail-send-email", unattended)).toBe(true);
    expect(registers("microsoft_outlook-reply-to-email", unattended)).toBe(true);
    expect(registers("slack-send-message-to-channel", unattended)).toBe(true);
    expect(registers("gmail-add-label-to-email", unattended)).toBe(false);
    expect(registers("gmail-delete-email", unattended)).toBe(false);

    const interactive = sessionGrants(ALL_GRANTS, true);
    expect(registers("gmail-add-label-to-email", interactive)).toBe(true);
    expect(registers("gmail-delete-email", interactive)).toBe(true);
  });

  it("a missing grant withholds its verbs, and an unknown verb counts as a change", () => {
    for (const interactive of [true, false]) {
      const sendOnly = sessionGrants({ write: false, send: true, delete: false }, interactive);
      expect(registers("gmail-delete-email", sendOnly)).toBe(false);
      // Never classified, so it falls to `write` rather than slipping through.
      expect(registers("gmail-archive-thread", sendOnly)).toBe(false);

      const writeOnly = sessionGrants({ write: true, send: false, delete: false }, interactive);
      expect(registers("gmail-send-email", writeOnly)).toBe(false);
      expect(registers("gmail-archive-thread", writeOnly)).toBe(interactive);
    }
  });
});
