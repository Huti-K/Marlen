import type { ModelSettings, ThinkingLevel } from "@marlen/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ParseKeys } from "i18next";
import * as React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { GroupLabel } from "@/components/ui/group-label";
import { OptionRow } from "@/components/ui/option-row";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/dates";
import { toast } from "@/lib/toast";
import { useAnchoredPopover } from "@/lib/useAnchoredPopover";
import { cn } from "@/lib/utils";

const THINKING_OPTIONS: { level: ThinkingLevel; labelKey: ParseKeys; hintKey: ParseKeys }[] = [
  { level: "off", labelKey: "chat.model.fast", hintKey: "chat.model.fastHint" },
  { level: "medium", labelKey: "chat.model.normal", hintKey: "chat.model.normalHint" },
  { level: "high", labelKey: "chat.model.thorough", hintKey: "chat.model.thoroughHint" },
];

const WINDOW_LABEL_KEYS: Partial<Record<string, ParseKeys>> = {
  "5h": "chat.model.window5h",
  week: "chat.model.windowWeek",
  month: "chat.model.windowMonth",
};

/** "max_20x" → "Max 20x": provider plan ids prettified, never translated. */
function planLabel(plan: string): string {
  return plan.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Label for a usage window: known ids translate, "week_<model>" becomes the
 *  week label plus the capitalized model tier, anything else shows raw. */
function windowLabel(id: string, t: (key: ParseKeys) => string): string {
  const known = WINDOW_LABEL_KEYS[id];
  if (known) return t(known);
  if (id.startsWith("week_")) {
    const model = id.slice("week_".length);
    return `${t("chat.model.windowWeek")} (${model.charAt(0).toUpperCase()}${model.slice(1)})`;
  }
  return id;
}

/** Popover meter fill by percent used: quiet green, then amber, then red. */
function severityFill(usedPct: number): string {
  if (usedPct >= 90) return "bg-destructive";
  if (usedPct >= 70) return "bg-warning";
  return "bg-success";
}

function severityStroke(usedPct: number): string {
  if (usedPct >= 90) return "stroke-destructive";
  if (usedPct >= 70) return "stroke-warning";
  return "stroke-success";
}

function severityText(usedPct: number): string {
  if (usedPct >= 90) return "text-destructive";
  if (usedPct >= 70) return "text-warning";
  return "text-success";
}

const RING_RADIUS = 6.5;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Circular used-so-far meter for the 5-hour window; the week lives in the
 *  popover. Track only while usage is unknown. */
function UsageRing({ usedPct }: { usedPct: number | null }) {
  return (
    // Rotated so the arc grows clockwise from 12 o'clock.
    <svg viewBox="0 0 16 16" className="-rotate-90" role="presentation" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2"
        className="stroke-foreground/12"
      />
      {usedPct !== null && (
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - usedPct / 100)}
          className={severityStroke(usedPct)}
        />
      )}
    </svg>
  );
}

/**
 * Composer control for the AI itself: a ring showing how much of the
 * subscription's tightest rate window is used. Clicking opens a compact
 * anchored popover headed by the active model's name: a section of one-line
 * meters per subscription plan (titled by provider), a chat-context section
 * with visible token counts, the thinking mode as a chip row
 * (Fast/Normal/Thorough), and a model switcher scoped to connected providers.
 * Full provider management stays in Settings.
 */
export function ModelControl({
  conversationId,
  className,
}: {
  conversationId?: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { open, setOpen, pos, triggerRef, popoverRef } = useAnchoredPopover<HTMLSpanElement>();

  const { data: settings } = useQuery({ queryKey: ["llm", "model"], queryFn: api.modelSettings });
  const { data: providers } = useQuery({
    queryKey: ["llm", "providers"],
    queryFn: api.llmProviders,
  });
  const usageQuery = useQuery({
    queryKey: ["llm", "usage"],
    queryFn: api.llmUsage,
    refetchInterval: 5 * 60_000,
  });
  const usages = usageQuery.data?.usages ?? [];
  // Only fetched while the popover is open; stale-on-reopen refetches keep it
  // current without polling for an element nobody is looking at.
  const contextQuery = useQuery({
    queryKey: ["llm", "context", conversationId],
    queryFn: () => api.llmContext(conversationId ?? ""),
    enabled: open && conversationId !== undefined,
  });
  const context = (conversationId !== undefined && contextQuery.data?.context) || null;

  // Freshen the meters at the moment the user looks at them.
  const refetchUsage = usageQuery.refetch;
  React.useEffect(() => {
    if (open) void refetchUsage();
  }, [open, refetchUsage]);

  if (!settings) return null;

  // The ring always measures the plan the active provider is burning; other
  // subscriptions' meters appear only in the popover. Within that plan it
  // tracks the 5-hour window, falling back to the tightest reported window.
  const activeUsage = usages.find((u) => u.provider === settings.provider) ?? null;
  const worstPct = activeUsage ? Math.max(...activeUsage.windows.map((w) => w.usedPct)) : null;
  const ringPct = activeUsage?.windows.find((w) => w.id === "5h")?.usedPct ?? worstPct;
  // Active plan first, so the meters read in the same order as the ring.
  const orderedUsages = [...usages].sort(
    (a, b) => Number(b.provider === settings.provider) - Number(a.provider === settings.provider),
  );

  // Connected providers only, but never drop the active one from under its value.
  const connected = new Set((providers ?? []).filter((p) => p.auth !== null).map((p) => p.id));
  const usable = settings.catalog.filter(
    (c) => c.models.length > 0 && (connected.has(c.id) || c.id === settings.provider),
  );

  const activeModelName =
    settings.catalog
      .find((c) => c.id === settings.provider)
      ?.models.find((m) => m.id === settings.model)?.name ?? settings.model;

  const applySettings = async (optimistic: ModelSettings, save: () => Promise<ModelSettings>) => {
    const previous = settings;
    queryClient.setQueryData(["llm", "model"], optimistic);
    try {
      queryClient.setQueryData(["llm", "model"], await save());
    } catch (err) {
      queryClient.setQueryData(["llm", "model"], previous);
      toast.error(err);
    }
  };

  const pickModel = (provider: string, model: string) => {
    setOpen(false);
    if (provider === settings.provider && model === settings.model) return;
    void applySettings({ ...settings, provider, model }, () => api.setModel(provider, model));
  };

  const pickThinking = (level: ThinkingLevel) => {
    if (level === settings.thinkingLevel) return;
    void applySettings({ ...settings, thinkingLevel: level }, () => api.setThinkingLevel(level));
  };

  const title =
    ringPct !== null
      ? `${settings.model} · ${t("chat.model.used", { pct: ringPct })}`
      : settings.model;

  return (
    <span ref={triggerRef} className={cn("inline-flex", className)}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("chat.model.buttonLabel")}
        aria-expanded={open}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="rounded-xl"
      >
        <UsageRing usedPct={ringPct} />
      </Button>

      {open &&
        createPortal(
          // Portaled content still bubbles React synthetic events up the
          // component tree (not the DOM tree) — this wrapper only guards that
          // propagation, so it isn't itself an interactive element.
          // biome-ignore lint/a11y/noStaticElementInteractions: propagation guard only, not a control itself
          <div
            ref={popoverRef}
            role="presentation"
            className="surface-pop animate-in-up fixed z-[130] flex max-h-[70vh] w-72 flex-col gap-3 overflow-y-auto p-3"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* The model answering right now, without scrolling to the picker. */}
            <p className="min-w-0 truncate text-sm font-medium" title={settings.model}>
              {activeModelName}
            </p>

            {/* One plan section per subscription that reports usage, active plan first. */}
            {orderedUsages.map((u) => (
              <section key={u.provider} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <GroupLabel size="sm">
                    {providers?.find((p) => p.id === u.provider)?.name ?? u.provider}
                  </GroupLabel>
                  {u.plan && (
                    <span className="min-w-0 truncate text-2xs text-muted-foreground">
                      {planLabel(u.plan)}
                    </span>
                  )}
                </div>
                {u.windows.map((w) => (
                  <MeterRow
                    key={w.id}
                    label={windowLabel(w.id, t)}
                    detail={w.resetsAt ? relativeTime(w.resetsAt, i18n.language) : undefined}
                    usedPct={w.usedPct}
                    title={
                      w.resetsAt
                        ? t("chat.model.resets", {
                            time: relativeTime(w.resetsAt, i18n.language),
                          })
                        : undefined
                    }
                  />
                ))}
              </section>
            ))}

            {context && (
              <section
                className="flex flex-col gap-1.5"
                title={t("chat.model.contextTokens", {
                  used: Math.round(context.tokens / 1000),
                  total: Math.round(context.contextWindow / 1000),
                })}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <GroupLabel size="sm">{t("chat.model.contextTitle")}</GroupLabel>
                  <span
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      severityText(context.usedPct),
                    )}
                  >
                    {t("chat.model.used", { pct: context.usedPct })}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={cn("h-full rounded-full", severityFill(context.usedPct))}
                    style={{ width: `${context.usedPct}%` }}
                  />
                </div>
              </section>
            )}

            {settings.reasoning && (
              <section className="flex flex-col gap-1.5">
                <GroupLabel size="sm">{t("chat.model.thinkingTitle")}</GroupLabel>
                <div className="flex gap-1">
                  {THINKING_OPTIONS.map(({ level, labelKey, hintKey }) => (
                    <Chip
                      key={level}
                      active={settings.thinkingLevel === level}
                      title={t(hintKey)}
                      onClick={() => pickThinking(level)}
                    >
                      {t(labelKey)}
                    </Chip>
                  ))}
                </div>
              </section>
            )}

            <section className="flex flex-col gap-1">
              <GroupLabel size="sm" className="pb-0.5">
                {t("chat.model.title")}
              </GroupLabel>
              {usable.length === 0 ? (
                <p className="px-1 py-1 text-xs text-muted-foreground">
                  {t("chat.model.noProviders")}
                </p>
              ) : (
                <div className="flex max-h-48 flex-col overflow-y-auto">
                  {usable.map((catalog) => (
                    <React.Fragment key={catalog.id}>
                      {usable.length > 1 && (
                        <p className="px-1 pt-1 pb-0.5 text-2xs text-muted-foreground">
                          {catalog.name}
                        </p>
                      )}
                      {catalog.models.map((model) => (
                        <OptionRow
                          key={model.id}
                          selected={catalog.id === settings.provider && model.id === settings.model}
                          label={model.name}
                          title={model.id}
                          onClick={() => pickModel(catalog.id, model.id)}
                          className="shrink-0 py-1.5"
                        />
                      ))}
                    </React.Fragment>
                  ))}
                </div>
              )}
            </section>
          </div>,
          document.body,
        )}
    </span>
  );
}

/** One-line meter: label (plus a muted inline detail like the reset time),
 *  thin bar, percent left. The title carries the detail's full sentence. */
function MeterRow({
  label,
  detail,
  usedPct,
  title,
}: {
  label: string;
  detail?: string;
  usedPct: number;
  title?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="min-w-0 flex-1 truncate text-xs">
        {label}
        {detail && <span className="text-2xs text-muted-foreground"> · {detail}</span>}
      </span>
      <div className="h-1 w-14 shrink-0 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full", severityFill(usedPct))}
          style={{ width: `${usedPct}%` }}
        />
      </div>
      <span
        className={cn(
          "w-20 shrink-0 text-right text-xs font-medium tabular-nums",
          severityText(usedPct),
        )}
      >
        {t("chat.model.left", { pct: 100 - usedPct })}
      </span>
    </div>
  );
}
