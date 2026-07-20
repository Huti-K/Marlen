import type { LeadStatus } from "@marlen/shared";

type Tone = "default" | "muted" | "success" | "warning" | "destructive";

/** Pastel status → tone: attention on "new", success once they replied. */
export const LEAD_STATUS_TONE: Record<LeadStatus, Tone> = {
  new: "warning",
  contacted: "muted",
  engaged: "success",
  qualified: "default",
  won: "success",
  lost: "muted",
};

export const LEAD_PRIORITIES = ["A", "B", "C"] as const;

/** Priority tier A/B/C, brightest on "A" so the hot leads pop. */
export const LEAD_PRIORITY_TONE: Record<(typeof LEAD_PRIORITIES)[number], Tone> = {
  A: "success",
  B: "default",
  C: "muted",
};
