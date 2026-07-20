import type { AgentCard, DelegationStatus } from "@marlen/shared";
import { Check, TriangleAlert, Waypoints } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Spinner } from "@/components/ui/spinner";
import { cn, stagger } from "@/lib/utils";
import { CardShell } from "./CardShell";

type DelegationData = Extract<AgentCard, { kind: "delegation" }>;

/** Marks one lane's state in the row's icon slot. */
function LaneMark({ status }: { status: DelegationStatus }) {
  if (status === "running") return <Spinner className="h-3 w-3" />;
  if (status === "done") return <Check className="h-3 w-3 text-muted-foreground" aria-hidden />;
  if (status === "failed") {
    return <TriangleAlert className="h-3 w-3 text-destructive" aria-hidden />;
  }
  return (
    <span className="flex h-3 w-3 items-center justify-center" aria-hidden>
      <span className="h-1.5 w-1.5 rounded-full bg-border" />
    </span>
  );
}

/**
 * The delegate tool's fan-out, one quiet lane per background worker. The
 * server re-publishes the card on every worker transition, so the lanes tick
 * from pending through running to settled live during the turn, then stand as
 * the record of what the answer drew on. Lanes are positional and never
 * reorder, so the row index is their identity.
 */
export function DelegationCard({ card }: { card: DelegationData }) {
  const { t } = useTranslation();
  const settled = card.tasks.filter(
    (task) => task.status === "done" || task.status === "failed",
  ).length;
  return (
    <CardShell
      icon={Waypoints}
      label={t("chat.cards.delegation.badge")}
      meta={`${settled}/${card.tasks.length}`}
    >
      <ul className="flex flex-col gap-1.5 px-4 pb-4 pt-0.5">
        {card.tasks.map((task, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: lanes are positional and never reorder
            key={i}
            className="animate-in-up flex items-center gap-2"
            style={stagger(i)}
          >
            <LaneMark status={task.status} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                task.status === "running" ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {task.label}
            </span>
            {task.elapsedMs !== undefined && (
              <span className="shrink-0 font-mono text-2xs text-muted-foreground tabular-nums">
                {Math.max(1, Math.round(task.elapsedMs / 1000))}s
              </span>
            )}
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
