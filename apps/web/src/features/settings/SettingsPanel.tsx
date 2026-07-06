import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  Sparkles,
  X,
} from "lucide-react";
import type { LlmProviderInfo, LoginFlowStatus, ModelSettings } from "@trailin/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConnectionsPanel } from "@/features/connections/ConnectionsPanel";
import { cn } from "@/lib/utils";

export function SettingsPanel({ onStatusChanged }: { onStatusChanged?: () => void }) {
  const [providers, setProviders] = React.useState<LlmProviderInfo[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      setProviders(await api.llmProviders());
      setError(null);
      onStatusChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [onStatusChanged]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Model"
          description="Which model the agent uses for chat and automations."
        />
        <ModelCard onSaved={refresh} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="LLM providers"
          description="Sign in with a subscription (Claude Pro/Max, GitHub Copilot, ChatGPT) or save an API key. Stored locally in data/auth.json."
        />
        <ProvidersCard providers={providers} onChanged={refresh} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title="Email accounts"
          description="Gmail and Outlook connections via Pipedream Connect."
        />
        <ConnectionsPanel />
      </section>
    </div>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

/* ---------------- Model picker ---------------- */

function ModelCard({ onSaved }: { onSaved: () => Promise<void> }) {
  const [settings, setSettings] = React.useState<ModelSettings | null>(null);
  const [provider, setProvider] = React.useState("");
  const [model, setModel] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api
      .modelSettings()
      .then((s) => {
        setSettings(s);
        setProvider(s.provider);
        setModel(s.model);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (!settings) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </CardContent>
      </Card>
    );
  }

  const activeCatalog = settings.catalog.find((c) => c.id === provider);
  const dirty = provider !== settings.provider || model !== settings.model;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const next = await api.setModel(provider, model);
      setSettings(next);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-provider">Provider</Label>
            <Select
              id="settings-provider"
              value={provider}
              onChange={(value) => {
                setProvider(value);
                const first = settings.catalog.find((c) => c.id === value)?.models[0];
                if (first) setModel(first);
              }}
              options={settings.catalog
                .filter((c) => c.models.length > 0)
                .map((c) => ({ value: c.id, label: c.name }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-model">Model</Label>
            <Select
              id="settings-model"
              value={model}
              onChange={setModel}
              options={(activeCatalog?.models ?? []).map((m) => ({ value: m, label: m }))}
            />
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex items-center gap-3">
          <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            Save
          </Button>
          <span className="text-xs text-muted-foreground">
            Active: <span className="font-mono">{settings.provider}/{settings.model}</span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Select({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/* ---------------- Provider list + login flows ---------------- */

function ProvidersCard({
  providers,
  onChanged,
}: {
  providers: LlmProviderInfo[] | null;
  onChanged: () => Promise<void>;
}) {
  const [flow, setFlow] = React.useState<LoginFlowStatus | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [keyEditor, setKeyEditor] = React.useState<string | null>(null);

  // Poll the login flow while one is pending.
  React.useEffect(() => {
    if (!flow || flow.done) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.loginStatus();
        setFlow(next);
        if (next.done) {
          clearInterval(timer);
          await onChanged();
        }
      } catch {
        // transient poll errors are fine
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [flow, onChanged]);

  if (!providers) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading providers…
        </CardContent>
      </Card>
    );
  }

  const startLogin = async (providerId: string) => {
    try {
      setFlow(await api.loginStart(providerId));
    } catch (err) {
      setFlow({
        providerId,
        done: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const subscription = providers.filter((p) => p.oauth);
  const rest = providers.filter((p) => !p.oauth);
  const restVisible = showAll ? rest : rest.filter((p) => p.auth !== null);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" /> Subscription sign-in
        </CardTitle>
        <CardDescription>
          Use an existing Claude Pro/Max, GitHub Copilot or ChatGPT plan — no API key needed.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {subscription.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            busy={Boolean(flow && !flow.done)}
            onLogin={() => void startLogin(p.id)}
            onLogout={async () => {
              await api.llmLogout(p.id);
              await onChanged();
            }}
            onEditKey={() => setKeyEditor(keyEditor === p.id ? null : p.id)}
          />
        ))}

        {flow && <LoginFlowCard flow={flow} onClose={() => setFlow(null)} />}

        {keyEditor && (
          <ApiKeyEditor
            providerId={keyEditor}
            onDone={async () => {
              setKeyEditor(null);
              await onChanged();
            }}
            onCancel={() => setKeyEditor(null)}
          />
        )}

        <div className="mt-2 border-t pt-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">
              API-key providers {showAll ? "" : "(configured only)"}
            </p>
            <Button variant="ghost" size="sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? <ChevronUp /> : <ChevronDown />}
              {showAll ? "Show fewer" : `Show all ${rest.length}`}
            </Button>
          </div>
          {restVisible.length === 0 && !showAll && (
            <p className="py-2 text-xs text-muted-foreground">
              None configured yet — “Show all” to add an API key for OpenAI, Google, Groq, OpenRouter…
            </p>
          )}
          <div className="flex flex-col gap-1.5 pt-1">
            {restVisible.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                busy={false}
                onLogin={undefined}
                onLogout={async () => {
                  await api.llmLogout(p.id);
                  await onChanged();
                }}
                onEditKey={() => setKeyEditor(keyEditor === p.id ? null : p.id)}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  provider,
  busy,
  onLogin,
  onLogout,
  onEditKey,
}: {
  provider: LlmProviderInfo;
  busy: boolean;
  onLogin?: () => void;
  onLogout: () => Promise<void>;
  onEditKey: () => void;
}) {
  const authBadge =
    provider.auth === "subscription" ? (
      <Badge variant="success">subscription</Badge>
    ) : provider.auth === "stored_key" ? (
      <Badge variant="success">API key</Badge>
    ) : provider.auth === "env" ? (
      <Badge variant="secondary" title={provider.authDetail}>
        env{provider.authDetail ? `: ${provider.authDetail}` : ""}
      </Badge>
    ) : (
      <Badge variant="outline">not connected</Badge>
    );

  const showLogout = provider.auth === "subscription" || provider.auth === "stored_key";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {provider.name}
          {authBadge}
        </p>
        <p className="text-xs text-muted-foreground">{provider.modelCount} models</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {onLogin && provider.auth !== "subscription" && (
          <Button size="sm" onClick={onLogin} disabled={busy}>
            Sign in
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onEditKey} title="Set API key">
          <KeyRound />
        </Button>
        {showLogout && (
          <Button variant="ghost" size="sm" onClick={() => void onLogout()} title="Sign out">
            <LogOut />
          </Button>
        )}
      </div>
    </div>
  );
}

function ApiKeyEditor({
  providerId,
  onDone,
  onCancel,
}: {
  providerId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [key, setKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveApiKey(providerId, key);
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <Label htmlFor="api-key-input" className="text-xs">
        API key for <span className="font-mono">{providerId}</span>
      </Label>
      <div className="flex gap-2">
        <Input
          id="api-key-input"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-…"
          className="font-mono"
          autoFocus
        />
        <Button size="sm" onClick={() => void save()} disabled={!key.trim() || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Check />}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <X />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/* ---------------- Interactive login flow ---------------- */

function LoginFlowCard({ flow, onClose }: { flow: LoginFlowStatus; onClose: () => void }) {
  const [input, setInput] = React.useState("");

  if (flow.done) {
    return (
      <div
        className={cn(
          "flex items-start justify-between gap-3 rounded-lg border p-3 text-sm",
          flow.error
            ? "border-destructive/40 bg-destructive/10"
            : "border-emerald-500/40 bg-emerald-500/10",
        )}
      >
        <p className={flow.error ? "text-destructive" : "text-emerald-700 dark:text-emerald-400"}>
          {flow.error ?? `Signed in with ${flow.providerName ?? flow.providerId}.`}
        </p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Signing in with {flow.providerName ?? flow.providerId}…
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await api.loginCancel();
            onClose();
          }}
        >
          Cancel
        </Button>
      </div>

      {flow.select && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{flow.select.message}</p>
          <div className="flex flex-wrap gap-2">
            {flow.select.options.map((option) => (
              <Button
                key={option.id}
                variant="outline"
                size="sm"
                onClick={() => void api.loginSelect(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {flow.authUrl && (
        <div className="flex flex-col gap-1.5">
          <Button
            size="sm"
            className="w-fit"
            onClick={() => window.open(flow.authUrl, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink /> Open sign-in page
          </Button>
          {flow.instructions && (
            <p className="text-xs text-muted-foreground">{flow.instructions}</p>
          )}
        </div>
      )}

      {flow.deviceCode && (
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-xs text-muted-foreground">
            Enter this code at{" "}
            <a
              href={flow.deviceCode.verificationUri}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              {flow.deviceCode.verificationUri}
            </a>
          </p>
          <p className="font-mono text-lg font-semibold tracking-widest">
            {flow.deviceCode.userCode}
          </p>
        </div>
      )}

      {(flow.prompt || flow.authUrl) && (
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              flow.prompt?.placeholder ?? "Paste the code / redirect URL if it doesn't finish…"
            }
            className="font-mono text-xs"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!input.trim()}
            onClick={async () => {
              await api.loginInput(input.trim());
              setInput("");
            }}
          >
            Submit
          </Button>
        </div>
      )}
      {flow.prompt && <p className="text-xs text-muted-foreground">{flow.prompt.message}</p>}
    </div>
  );
}
