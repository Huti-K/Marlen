import * as React from "react";
import { ExternalLink, Inbox, Loader2, Mail, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  EMAIL_APPS,
  EMAIL_APP_LABELS,
  type AccountColor,
  type ConnectedAccount,
  type EmailApp,
  type PipedreamApp,
} from "@trailin/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { ColorPicker } from "@/components/ui/color-picker";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/lib/toast";
import { errorMessage } from "@/lib/utils";

/** Suggested first — the full catalog is a search away. */
const SUGGESTED_APPS: PipedreamApp[] = EMAIL_APPS.map((slug) => ({
  slug,
  name: EMAIL_APP_LABELS[slug],
}));

function appLabel(account: ConnectedAccount): string {
  if (account.appName) return account.appName;
  const known = EMAIL_APP_LABELS[account.app as EmailApp];
  if (known) return known;
  return account.app
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Generates a nice vibrant pastel tone by varying the hue. */
function generateTonalHex(index: number): string {
  // Golden angle approximation (137.5) distributes hues nicely around the 360 wheel
  const hue = (index * 137.5) % 360;
  // HSL: 70% saturation, 65% lightness
  const s = 0.7;
  const l = 0.65;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Connected accounts (any app, several per app) + the Connect-Link picker.
 * Shared between the first-run setup and Settings → Email.
 */
export function Accounts({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [accounts, setAccounts] = React.useState<ConnectedAccount[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [polling, setPolling] = React.useState(false);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PipedreamApp[] | null>(SUGGESTED_APPS);
  const [confirmId, setConfirmId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);
  const [colors, setColors] = React.useState<AccountColor[]>([]);
  // Account ids at the moment a connect tab was opened; polling stops on change.
  const snapshot = React.useRef<string>("");

  // Debounced catalog search; empty query shows the e-mail suggestions.
  React.useEffect(() => {
    if (!pickerOpen) return;
    const q = query.trim();
    if (!q) {
      setResults(SUGGESTED_APPS);
      return;
    }
    setResults(null);
    const timer = setTimeout(() => {
      api
        .pipedreamApps(q)
        .then(setResults)
        .catch((err) => {
          toast.error(errorMessage(err));
          setResults([]);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, pickerOpen]);

  const load = React.useCallback(async (): Promise<ConnectedAccount[] | null> => {
    try {
      const next = await api.pipedreamAccounts();
      setAccounts(next);
      return next;
    } catch (err) {
      toast.error(errorMessage(err));
      return null;
    }
  }, []);

  const loadColors = React.useCallback(async () => {
    try {
      const { colors: saved } = await api.accountColors();
      setColors(saved);
      return saved;
    } catch {
      return [] as AccountColor[];
    }
  }, []);

  // Auto-assign nice tonal colors for accounts that don't have one yet.
  const ensureColors = React.useCallback(
    async (accts: ConnectedAccount[], existing: AccountColor[]) => {
      const missing = accts.filter((a) => !existing.some((c) => c.accountId === a.id));
      if (missing.length === 0) return;

      let idx = existing.length;

      const additions: AccountColor[] = missing.map((a) => {
        const hex = generateTonalHex(idx);
        idx++;
        return { accountId: a.id, hex };
      });

      const merged = [...existing, ...additions];
      setColors(merged);
      try {
        await api.setAccountColors(merged);
      } catch {
        // best-effort persist
      }
    },
    [],
  );

  React.useEffect(() => {
    void Promise.all([load(), loadColors()]).then(([accts, saved]) => {
      if (accts && saved) void ensureColors(accts, saved);
    });
  }, [load, loadColors, ensureColors]);

  React.useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (next && JSON.stringify(next.map((a) => a.id)) !== snapshot.current) {
          setPolling(false);
          onChanged?.();
        }
      });
    }, 3000);
    const giveUp = setTimeout(() => setPolling(false), 180_000);
    return () => {
      clearInterval(timer);
      clearTimeout(giveUp);
    };
  }, [polling, load, onChanged]);

  const connect = async (app: string) => {
    setBusy(app);
    try {
      const { connectLinkUrl } = await api.pipedreamConnectToken(app);
      snapshot.current = JSON.stringify((accounts ?? []).map((a) => a.id));
      window.open(connectLinkUrl, "_blank", "noopener,noreferrer");
      setPickerOpen(false);
      setQuery("");
      setPolling(true);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setRemoving(true);
    try {
      await api.deletePipedreamAccount(id);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRemoving(false);
      setConfirmId(null);
    }
  };

  const updateColor = async (
    accountId: string,
    hex: string,
  ) => {
    const next = colors.filter((c) => c.accountId !== accountId);
    next.push({ accountId, hex });
    setColors(next);
    try {
      await api.setAccountColors(next);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const colorFor = (accountId: string): AccountColor | undefined =>
    colors.find((c) => c.accountId === accountId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4 pb-2">
          <h3 className="text-sm font-semibold tracking-tight">
            {t("connections.emailAccounts")}
          </h3>
          <Button
            size="sm"
            onClick={() => setPickerOpen((open) => !open)}
            disabled={busy !== null}
          >
            {busy ? <Loader2 className="animate-spin" /> : <ExternalLink />}
            {t("connections.addAccount")}
          </Button>
        </div>

        {pickerOpen && (
          <Card padding="sm" className="flex flex-col gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("connections.searchProviders")}
              autoFocus
            />
            {!results ? (
              <div className="flex flex-col gap-1.5 py-1">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-8 w-full rounded-md" />
                ))}
              </div>
            ) : results.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">
                {t("connections.noProvidersFound", { q: query.trim() })}
              </p>
            ) : (
              <div className="flex flex-col">
                {results.map((app) => (
                  <button
                    key={app.slug}
                    type="button"
                    onClick={() => void connect(app.slug)}
                    disabled={busy !== null}
                    className="flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-50"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{app.name}</span>
                    </span>
                    {busy === app.slug ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </Card>
        )}

        {polling && (
          <p className="text-xs text-muted-foreground">{t("connections.finishConnecting")}</p>
        )}

        {!accounts ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <ListRow key={i}>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
                <Skeleton className="h-5 w-16 rounded-full" />
              </ListRow>
            ))}
          </div>
        ) : accounts.length === 0 ? (
          <EmptyState icon={Inbox} description={t("connections.noAccounts")} />
        ) : (
          <div className="flex flex-col gap-2">
            {accounts.map((account, i) => (
              <ListRow
                key={account.id}
                className="animate-in-up relative"
                style={{ animationDelay: `${i * 45}ms`, zIndex: accounts.length - i }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <ColorPicker
                    color={colorFor(account.id)?.hex ?? "#616161"}
                    onSelect={(hex) => void updateColor(account.id, hex)}
                  />
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{account.name}</p>
                    <p className="text-xs text-muted-foreground">{appLabel(account)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={account.healthy ? "success" : "destructive"}>
                    {account.healthy ? t("connections.healthy") : t("connections.unhealthy")}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setConfirmId(account.id)}
                    title={t("connections.disconnect")}
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              </ListRow>
            ))}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(next) => !next && setConfirmId(null)}
        title={t("connections.disconnect")}
        description={t("connections.disconnectConfirm")}
        confirmLabel={t("connections.disconnect")}
        variant="destructive"
        busy={removing}
        onConfirm={() => confirmId && void remove(confirmId)}
      />
    </div>
  );
}
