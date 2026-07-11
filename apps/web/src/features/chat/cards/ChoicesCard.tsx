import type { AccountColor, AgentCard, ChoiceOption } from "@trailin/shared";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { CardShell } from "./CardShell";

type ChoicesData = Extract<AgentCard, { kind: "choices" }>;

/**
 * The agent's clarifying question, answered with one click. Picking a row
 * sends its `reply` (falling back to `label`) as the next chat message via
 * `trailin:answer-chat`, carrying the option's `ref` when it names a
 * specific email — ChatPanel sends it in the SAME conversation, never a new
 * one, since this is the answer to a question already asked there.
 */
export function ChoicesCard({ card, colors }: { card: ChoicesData; colors?: AccountColor[] }) {
  const { t } = useTranslation();
  const { question, options } = card;

  const pick = (option: ChoiceOption) => {
    window.dispatchEvent(
      new CustomEvent("trailin:answer-chat", {
        detail: { text: option.reply ?? option.label, refs: option.ref ? [option.ref] : undefined },
      }),
    );
  };

  const hexFor = (accountId?: string) => colors?.find((c) => c.accountId === accountId)?.hex;

  return (
    <CardShell icon={CircleHelp} label={t("chat.cards.choices.title")} title={question}>
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {options.map((option, index) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: options are a fixed list from one card, order is stable and labels can repeat
            key={index}
            type="button"
            onClick={() => pick(option)}
            className="flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-2"
          >
            <span className="flex w-full min-w-0 items-center gap-1.5">
              {option.ref?.accountId && <AccountDot color={hexFor(option.ref.accountId)} />}
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{option.label}</span>
            </span>
            {option.detail && (
              <span className="w-full truncate text-xs text-muted-foreground">{option.detail}</span>
            )}
          </button>
        ))}
      </div>
    </CardShell>
  );
}
