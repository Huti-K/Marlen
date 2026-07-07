import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import {
  LANGUAGE_LABELS,
  SUPPORTED_LANGUAGES,
  isLanguage,
  type LlmProviderInfo,
  type ModelSettings,
} from "@trailin/shared";
import { api } from "@/lib/api";
import { rememberLanguage } from "@/lib/i18n";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { useNavLayout, type NavLayout } from "@/lib/useNavLayout";
import { ConnectionsPanel } from "@/features/connections/ConnectionsPanel";
import { Providers } from "@/features/settings/Providers";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";

export function SettingsPanel({ onStatusChanged }: { onStatusChanged?: () => void }) {
  const { t } = useTranslation();
  const [providers, setProviders] = React.useState<LlmProviderInfo[] | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setProviders(await api.llmProviders());
      onStatusChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }, [onStatusChanged]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectedIds = React.useMemo(
    () => providers?.filter((p) => p.auth !== null).map((p) => p.id) ?? [],
    [providers],
  );

  return (
    <div className="flex flex-col gap-10 pt-4">
      <Section
        index={0}
        title={t("settings.sections.ai.title")}
        description={t("settings.sections.ai.description")}
      >
        <div className="flex flex-col gap-5">
          <Providers providers={providers} onChanged={refresh} />
          <ModelPicker connectedIds={connectedIds} onSaved={refresh} />
        </div>
      </Section>

      <Section
        index={1}
        title={t("settings.sections.email.title")}
        description={t("settings.sections.email.description")}
      >
        <ConnectionsPanel onStatusChanged={onStatusChanged} />
      </Section>

      <Section
        index={2}
        layout="row"
        title={t("settings.sections.language.title")}
        description={t("settings.sections.language.description")}
      >
        <LanguagePicker />
      </Section>

      <Section
        index={3}
        layout="row"
        title="Navigation Style"
        description="Choose between a left sidebar or a floating bottom dock"
      >
        <NavLayoutPicker />
      </Section>
    </div>
  );
}

function NavLayoutPicker() {
  const [layout, setLayout] = useNavLayout();

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Select
        id="settings-nav-layout"
        aria-label="Navigation Layout"
        className="w-40"
        value={layout}
        onChange={(value) => setLayout(value as NavLayout)}
        options={[
          { value: "dock", label: "Bottom Dock" },
          { value: "sidebar", label: "Left Sidebar" }
        ]}
      />
    </div>
  );
}

function Section({
  title,
  description,
  children,
  index = 0,
  layout = "stack",
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  index?: number;
  layout?: "stack" | "row";
}) {
  const header = (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );

  return (
    <section
      className="animate-in-up relative flex flex-col gap-4"
      style={{ animationDelay: `${index * 70}ms`, zIndex: 10 - index }}
    >
      {layout === "row" ? (
        <div className="flex items-center justify-between gap-4">
          {header}
          {children}
        </div>
      ) : (
        <>
          {header}
          {children}
        </>
      )}
    </section>
  );
}

/* ---------------- Language picker ---------------- */

function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const [state, setState] = React.useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  // Auto-save like the model picker: persist on change, no Save button. The
  // server resets agent sessions so the assistant answers in the new language.
  const persist = async (value: string) => {
    if (!isLanguage(value) || value === i18n.language) return;
    setState("saving");
    setError(null);
    try {
      const { language } = await api.setLanguage(value);
      await i18n.changeLanguage(language);
      rememberLanguage(language);
      setState("idle");
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      <Select
        id="settings-language"
        aria-label={t("settings.sections.language.title")}
        className="w-40"
        value={i18n.language}
        onChange={(value) => void persist(value)}
        options={SUPPORTED_LANGUAGES.map((code) => ({
          value: code,
          label: LANGUAGE_LABELS[code],
        }))}
      />
      <div className="flex h-4 items-center justify-end gap-1.5 text-xs text-muted-foreground">
        {state === "saving" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.saving")}
          </>
        ) : state === "error" ? (
          <span className="text-destructive">{error}</span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Model picker ---------------- */

function ModelPicker({
  connectedIds,
  onSaved,
}: {
  connectedIds: string[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = React.useState<ModelSettings | null>(null);
  const [provider, setProvider] = React.useState("");
  const [model, setModel] = React.useState("");
  const [state, setState] = React.useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .modelSettings()
      .then((s) => {
        setSettings(s);
        setProvider(s.provider);
        setModel(s.model);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  if (!settings) {
    return error ? <ErrorBanner>{error}</ErrorBanner> : <LoadingRow />;
  }

  // Only offer models from providers you're connected to (but always keep the
  // active provider selectable so the current value stays valid).
  const connectedSet = new Set(connectedIds);
  const usable = settings.catalog.filter(
    (c) => c.models.length > 0 && (connectedSet.has(c.id) || c.id === settings.provider),
  );

  if (connectedIds.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("settings.signInFirst")}</p>;
  }

  const activeCatalog = usable.find((c) => c.id === provider);

  // Auto-save: persist as soon as the provider or model changes — no Save button.
  const persist = async (nextProvider: string, nextModel: string) => {
    setProvider(nextProvider);
    setModel(nextModel);
    if (!nextModel) return;
    setState("saving");
    setError(null);
    try {
      const next = await api.setModel(nextProvider, nextModel);
      setSettings(next);
      setState("idle");
      await onSaved();
    } catch (err) {
      setState("error");
      setError(errorMessage(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-provider">{t("settings.provider")}</Label>
          <Select
            id="settings-provider"
            value={provider}
            onChange={(value) =>
              void persist(value, usable.find((c) => c.id === value)?.models[0] ?? "")
            }
            options={usable.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-model">{t("settings.model")}</Label>
          <Select
            id="settings-model"
            value={model}
            onChange={(value) => void persist(provider, value)}
            options={(activeCatalog?.models ?? []).map((m) => ({ value: m, label: m }))}
          />
        </div>
      </div>
      <div className="flex h-4 items-center justify-end gap-1.5 text-xs text-muted-foreground">
        {state === "saving" ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.saving")}
          </>
        ) : state === "error" ? (
          <span className="text-destructive">{error}</span>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 text-success" />
            <span>
              <Trans
                i18nKey="settings.usingModel"
                values={{ model: settings.model }}
                components={{ model: <span className="font-mono" /> }}
              />
            </span>
          </>
        )}
      </div>
    </div>
  );
}
