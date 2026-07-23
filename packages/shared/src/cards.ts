import type { LeadStatus } from "./index.js";

export interface EmailRef {
  threadId: string;
  accountId: string;
  accountName?: string;
  messageId?: string;
  subject?: string;
  from?: string;
  date?: string;
}

export interface CardAccount {
  accountId: string;
  name: string;
  app: string;
  appName?: string;
  imgSrc?: string;
}

export interface EmailThreadMessage {
  id?: string;
  from: string;
  to: string[];
  cc?: string[];
  date: string;
  /** Rendered literally: email bodies are never markdown. */
  body: string;
  subject?: string;
  isUnread?: boolean;
  isFromMe?: boolean;
}

export interface DraftPreview {
  /** The mailbox draft id; absent while the draft is only a proposal. */
  draftId?: string;
  /** The chat proposal this card fronts; keeping it creates the mailbox draft. */
  proposalId?: string;
  threadId?: string;
  subject: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  body: string;
  /** The account signature appended below the body on send; shown, never part of the editable body. */
  signatureText?: string;
  webUrl?: string;
  attachments?: { filename: string; size?: number }[];
}

/** A real enum the UI groups on, never a marker parsed back out of prose. */
export const BRIEFING_PRIORITIES = ["urgent", "reply", "action", "fyi"] as const;
export type BriefingPriority = (typeof BRIEFING_PRIORITIES)[number];

export interface BriefingItem {
  threadId: string;
  messageId?: string;
  accountId?: string;
  sender: string;
  senderEmail?: string;
  subject: string;
  gist: string;
  priority: BriefingPriority;
  deadline?: string;
  receivedAt?: string;
  draftId?: string;
  webUrl?: string;
}

export interface BriefingRollup {
  label: string;
  items: BriefingItem[];
}

export interface ChoiceOption {
  label: string;
  detail?: string;
  /** Reply sent when picked; defaults to `label`. */
  reply?: string;
  ref?: EmailRef;
}

/** A real enum the UI renders marks from, never a state parsed out of prose. */
export const DELEGATION_STATUSES = ["pending", "running", "done", "failed"] as const;
export type DelegationStatus = (typeof DELEGATION_STATUSES)[number];

/** One background worker's lane in a delegation card. */
export interface DelegationTask {
  /** Display label derived from the worker's task instruction. */
  label: string;
  status: DelegationStatus;
  /** Worker runtime, present once the task has finished. */
  elapsedMs?: number;
}

export interface AttachmentItem {
  accountId: string;
  messageId: string;
  filename: string;
  /** Provider's declared type, for display only: the served MIME is derived from the filename. */
  mimeType?: string;
  size?: number;
  viewable: boolean;
  saveable: boolean;
}

/** A leads-directory row the agent surfaces in chat: the row's display fields. */
export interface LeadCardData {
  id: string;
  email: string;
  status: LeadStatus;
  name?: string;
  /** Tier A/B/C; omitted when unassessed. */
  priority?: "A" | "B" | "C";
  language?: string;
  interest?: string;
  persona?: string;
  phone?: string;
  notes?: string;
  lastInboundAt?: string;
  lastOutboundAt?: string;
}

export const CHART_KINDS = ["bar", "line"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** A bar's color by meaning, reusing the app's semantic tones; default is the accent. */
export const CHART_TONES = ["accent", "success", "warning", "danger", "neutral"] as const;
export type ChartTone = (typeof CHART_TONES)[number];

export interface ChartPoint {
  label: string;
  value: number;
  tone?: ChartTone;
}

export type AgentCard =
  | {
      kind: "email_draft";
      account?: CardAccount;
      draft: DraftPreview;
      /** Learned style directives this draft was written under; absent when the account has no learned voice. */
      voiceDirectives?: string[];
    }
  | { kind: "delegation"; tasks: DelegationTask[] }
  | { kind: "lead"; lead: LeadCardData }
  | {
      kind: "chart";
      chartType: ChartKind;
      title?: string;
      /** Unit suffix for values, e.g. "€", "%", "emails". */
      unit?: string;
      points: ChartPoint[];
    }
  | { kind: "message_draft"; channel: string; targetLabel: string; body: string; draftId: string }
  | {
      kind: "attachments";
      account?: CardAccount;
      subject?: string;
      items: AttachmentItem[];
    }
  | {
      kind: "choices";
      question: string;
      options: ChoiceOption[];
    }
  | {
      kind: "briefing";
      headline?: string;
      periodLabel?: string;
      accounts?: CardAccount[];
      items: BriefingItem[];
      rollups?: BriefingRollup[];
      scanned?: number;
    };
