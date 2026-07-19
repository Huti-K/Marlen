import { Sparkles } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ChangelogDialog } from "@/components/ChangelogDialog";
import { Button } from "@/components/ui/button";
import { desktopBridge } from "@/lib/desktop";

/**
 * Desktop shell only (no-op in the browser): a persistent accent button pinned
 * bottom-left once an update has downloaded and is waiting for a restart. It
 * opens the changelog, where the new version's notes sit above the restart CTA.
 */
export function UpdateButton() {
  const { t } = useTranslation();
  const [version, setVersion] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;
    void bridge.getPendingUpdate().then((pending) => {
      if (pending) setVersion(pending);
    });
    return bridge.onUpdateReady(setVersion);
  }, []);

  if (!version) return null;

  return (
    <>
      <div className="animate-in-up fixed bottom-4 left-4 z-[100]">
        <Button onClick={() => setOpen(true)} aria-label={t("app.updateAvailable")}>
          <Sparkles />
          {t("app.updateAvailable")}
        </Button>
      </div>
      <ChangelogDialog open={open} onOpenChange={setOpen} pendingVersion={version} />
    </>
  );
}
