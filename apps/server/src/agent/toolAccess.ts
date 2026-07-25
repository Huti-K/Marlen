import type { AccountPermissions } from "@marlen/shared";

/**
 * What one account's grants allow, stripped of the account id: the shape both
 * the tool registration policy and the prompt's account list read.
 */
export type ActionGrants = Omit<AccountPermissions, "accountId">;

export const NO_GRANTS: ActionGrants = { write: false, send: false, delete: false };

/**
 * Which MCP tools get registered at all, decided per tool by the verb its
 * action name starts with (Pipedream names every tool `app-verb-object`).
 * Reads (find/get/list/search/…) are ALWAYS registered, regardless of any
 * grant. Every other verb needs the matching per-account grant: send verbs
 * need `send`, delete verbs need `delete`, and every remaining verb (create,
 * update, move, label, and any verb this policy has never seen) needs `write`,
 * so an unclassified verb always requires an explicit grant instead of
 * slipping through. Pipedream's own create-draft is kept even on a read-only
 * account (drafts never dispatch mail) for apps without a DraftProvider.
 * Download verbs are never registered: raw attachment bytes would land base64
 * in model context; attachments go through the local list/save-attachment
 * tools.
 */
const READ_VERBS = /^(find|get|list|search|fetch|retrieve)(-|$)/;
const SEND_VERBS = /^(send|reply|forward|publish)(-|$)/;
const DELETE_VERBS = /^(delete|remove|trash|destroy|purge)(-|$)/;
const EXCLUDED_VERBS = /^download(-|$)/;
const DRAFT_ONLY = /^create-draft(-|$)/;

export type ActionCategory = "excluded" | "read" | "draft" | "send" | "delete" | "write";

function classifyAction(action: string): ActionCategory {
  if (EXCLUDED_VERBS.test(action)) return "excluded";
  if (DRAFT_ONLY.test(action)) return "draft";
  if (READ_VERBS.test(action)) return "read";
  if (SEND_VERBS.test(action)) return "send";
  if (DELETE_VERBS.test(action)) return "delete";
  return "write";
}

function actionOf(mcpToolName: string): string {
  return mcpToolName.replace(/^[a-z0-9_]+-/, "");
}

/**
 * The category one MCP tool registers under, or null when the policy above
 * skips it. `granted` is the session's effective grant set, so an unattended
 * run's dropped write/delete grants take effect here.
 */
export function registeredCategory(
  mcpToolName: string,
  granted: ActionGrants,
): ActionCategory | null {
  const category = classifyAction(actionOf(mcpToolName));
  if (category === "excluded") return null;
  if (category === "read" || category === "draft") return category;
  return granted[category] ? category : null;
}

/**
 * The grants a session actually runs under. An armed `send` holds everywhere:
 * an automation sends on its own standing instruction, which is what the user
 * armed the grant for. Creating, changing and deleting stay interactive-only
 * however they are granted, so an unattended run reading attacker-controllable
 * mail with nobody watching can never reorganize or destroy an account.
 */
export function sessionGrants(stored: ActionGrants, interactive: boolean): ActionGrants {
  return {
    write: interactive && stored.write,
    send: stored.send,
    delete: interactive && stored.delete,
  };
}
