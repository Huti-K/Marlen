import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

interface Alternative {
  id: string;
  name: string;
  model: string;
}

/**
 * Inline notice for a rate-limited turn: a plain-language explanation plus a
 * one-click switch to each other connected provider. Switching picks the
 * provider's first catalog model, the same default the Settings picker applies
 * on a provider change; the user resends their message afterwards.
 */
export function RateLimitNotice() {
  const { t } = useTranslation();
  const [alternatives, setAlternatives] = React.useState<Alternative[]>([]);
  const [switchedTo, setSwitchedTo] = React.useState<string | null>(null);
  const [switching, setSwitching] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([api.llmProviders(), api.modelSettings()])
      .then(([providers, settings]) => {
        if (cancelled) return;
        const models = new Map(settings.catalog.map((c) => [c.id, c.models]));
        setAlternatives(
          providers.flatMap((p) => {
            const model = models.get(p.id)?.[0];
            return p.auth !== null && p.id !== settings.provider && model
              ? [{ id: p.id, name: p.name, model }]
              : [];
          }),
        );
      })
      // Nothing to offer, the generic message stands on its own.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const switchTo = async (alternative: Alternative) => {
    setSwitching(alternative.id);
    try {
      await api.setModel(alternative.id, alternative.model);
      setSwitchedTo(alternative.name);
    } catch (err) {
      toast.error(err);
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p>{t("chat.rateLimited.message")}</p>
      {switchedTo ? (
        <p className="text-muted-foreground">
          {t("chat.rateLimited.switched", { provider: switchedTo })}
        </p>
      ) : (
        alternatives.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {alternatives.map((alternative) => (
              <Button
                key={alternative.id}
                size="sm"
                variant="secondary"
                loading={switching === alternative.id}
                disabled={switching !== null}
                onClick={() => void switchTo(alternative)}
              >
                {t("chat.rateLimited.switch", { provider: alternative.name })}
              </Button>
            ))}
          </div>
        )
      )}
    </div>
  );
}
