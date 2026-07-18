import type { AccountColor, AgentCard, ChoiceOption } from "@trailin/shared";
import { CircleHelp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccountDot } from "@/components/ui/account-dot";
import { OptionRow } from "@/components/ui/option-row";
import { accountColor } from "@/lib/accounts";
import { dispatchTrailin } from "@/lib/trailinEvents";
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
    dispatchTrailin("answer-chat", {
      text: option.reply ?? option.label,
      refs: option.ref ? [option.ref] : undefined,
    });
  };

  const hexFor = (accountId?: string) => accountColor(colors, accountId);

  return (
    <CardShell icon={CircleHelp} label={t("chat.cards.choices.title")} title={question}>
      <div className="flex flex-col gap-0.5 px-2 pb-2">
        {options.map((option, index) => (
          <OptionRow
            // biome-ignore lint/suspicious/noArrayIndexKey: options are a fixed list from one card, order is stable and labels can repeat
            key={index}
            fill="bare"
            onClick={() => pick(option)}
            icon={
              option.ref?.accountId ? (
                <AccountDot color={hexFor(option.ref.accountId)} />
              ) : undefined
            }
            label={option.label}
            detail={option.detail}
          />
        ))}
      </div>
    </CardShell>
  );
}
