import { MessageSquareShare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { openRunInChat } from "@/lib/quickActions";

/** Per-run "continue in chat" icon action shared by the activity feeds. */
export function OpenRunInChatButton({
  runId,
  onNavigateToChat,
}: {
  runId: string;
  /** Route change to perform once the run's conversation is targeted. */
  onNavigateToChat: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      title={t("home.openInChat")}
      aria-label={t("home.openInChat")}
      onClick={(e) => {
        e.stopPropagation();
        openRunInChat(runId, onNavigateToChat);
      }}
    >
      <MessageSquareShare />
    </Button>
  );
}
