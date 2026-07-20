import type { RunTrigger } from "@marlen/shared";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { dateTimeLabel } from "@/lib/dates";

/**
 * Why a run fired, when it was anything other than its plain schedule. A
 * catch-up run carries the slot it covered — the only place the app admits
 * that scheduled runs were missed while it was closed.
 */
export function RunTriggerBadge({ trigger }: { trigger: RunTrigger | null }) {
  const { t, i18n } = useTranslation();
  if (!trigger) return null;

  if (trigger.kind === "catchUp") {
    const when = dateTimeLabel(trigger.dueAt, i18n.language);
    return (
      <Badge variant="warning" data-tooltip={t("home.triggerCatchUpDetail", { when })}>
        {t("home.triggerCatchUp")}
      </Badge>
    );
  }
  if (trigger.kind === "todo") {
    return (
      <Badge variant="muted" data-tooltip={t("home.triggerTodoDetail", { title: trigger.title })}>
        {t("home.triggerTodo")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="muted"
      data-tooltip={t("home.triggerMailDetail", { accounts: trigger.accountNames.join(", ") })}
    >
      {t("home.triggerMail")}
    </Badge>
  );
}
