import * as React from "react";
import { ExternalLink, Inbox, Loader2, Mail, RefreshCw, Trash2 } from "lucide-react";
import { EMAIL_APPS, EMAIL_APP_LABELS, type ConnectedAccount, type EmailApp } from "@trailin/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ConnectionsPanel() {
  const [accounts, setAccounts] = React.useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [connecting, setConnecting] = React.useState<EmailApp | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAccounts(await api.accounts());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = async (app: EmailApp) => {
    setConnecting(app);
    setError(null);
    try {
      const { connectLinkUrl } = await api.connectToken(app);
      window.open(connectLinkUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(null);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Disconnect this account?")) return;
    try {
      await api.deleteAccount(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Connect an email account</CardTitle>
          <CardDescription>
            The OAuth flow runs on a Pipedream-hosted page. After finishing it, come back and
            hit refresh — the agent picks up new accounts on the next conversation.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {EMAIL_APPS.map((app) => (
            <Button key={app} onClick={() => void connect(app)} disabled={connecting !== null}>
              {connecting === app ? <Loader2 className="animate-spin" /> : <ExternalLink />}
              Connect {EMAIL_APP_LABELS[app]}
            </Button>
          ))}
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ul className="flex flex-col divide-y">
              {[0, 1].map((i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-4 w-4" />
                    <div className="flex flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-16" />
                </li>
              ))}
            </ul>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted-foreground">
                <Inbox className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium">No accounts connected</p>
              <p className="max-w-xs text-pretty text-xs text-muted-foreground">
                Connect Gmail or Outlook above so the agent can read and act on your mail.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y">
              {accounts.map((account, i) => (
                <li
                  key={account.id}
                  className="animate-in-up flex items-center justify-between gap-3 py-3"
                  style={{ animationDelay: `${i * 45}ms` }}
                >
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{account.name}</p>
                      <p className="text-xs text-muted-foreground">{account.app}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={account.healthy ? "success" : "destructive"}>
                      {account.healthy ? "healthy" : "unhealthy"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void remove(account.id)}
                      title="Disconnect"
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
