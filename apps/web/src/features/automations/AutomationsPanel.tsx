import * as React from "react";
import { CalendarClock, ChevronDown, ChevronUp, Loader2, Play, Plus, Trash2 } from "lucide-react";
import type { Automation, AutomationRun } from "@trailin/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const EXAMPLES = [
  { label: "Morning digest", schedule: "0 8 * * 1-5", instruction: "Summarize all unread emails from the last 24 hours across my accounts. Group by account, flag anything urgent." },
  { label: "Weekly cleanup report", schedule: "0 18 * * 5", instruction: "List newsletters and promotional emails received this week that I never opened, so I can decide what to unsubscribe from." },
];

// Format check for a standard 5-field cron expression (min hour dom month dow).
const CRON_FIELD = /^(\*|\d+)(-\d+)?(\/\d+)?(,(\*|\d+)(-\d+)?(\/\d+)?)*$/;
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => CRON_FIELD.test(p));
}

export function AutomationsPanel() {
  const [automations, setAutomations] = React.useState<Automation[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", schedule: "0 8 * * *", instruction: "" });
  const cronValid = isValidCron(form.schedule);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      setAutomations(await api.automations());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.createAutomation(form);
      setForm({ name: "", schedule: "0 8 * * *", instruction: "" });
      setShowForm(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus /> New automation
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>New automation</CardTitle>
            <CardDescription>
              The schedule is a standard cron expression (minute hour day month weekday).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((example) => (
                <Button
                  key={example.label}
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setForm({
                      name: example.label,
                      schedule: example.schedule,
                      instruction: example.instruction,
                    })
                  }
                >
                  {example.label}
                </Button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="automation-name">Name</Label>
                <Input
                  id="automation-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Morning digest"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="automation-schedule">Schedule (cron)</Label>
                <Input
                  id="automation-schedule"
                  value={form.schedule}
                  onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                  placeholder="0 8 * * 1-5"
                  aria-invalid={!cronValid}
                  className={cn(
                    "font-mono tabular",
                    !cronValid &&
                      form.schedule.trim() &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
                />
                {form.schedule.trim() && !cronValid ? (
                  <p className="text-xs text-destructive">
                    Needs five space-separated fields: minute hour day month weekday.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">0 8 * * 1-5</span> runs at 08:00 on weekdays.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="automation-instruction">Instruction for the agent</Label>
              <Textarea
                id="automation-instruction"
                value={form.instruction}
                onChange={(e) => setForm({ ...form, instruction: e.target.value })}
                placeholder="Summarize all unread emails from the last 24 hours…"
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => void create()}
                disabled={saving || !form.name.trim() || !form.instruction.trim() || !cronValid}
              >
                {saving && <Loader2 className="animate-spin" />}
                Create
              </Button>
              <Button variant="ghost" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        [0, 1].map((i) => (
          <Card key={i} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-3 w-64" />
              </div>
              <Skeleton className="h-8 w-24 rounded-md" />
            </div>
          </Card>
        ))
      ) : automations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-secondary text-muted-foreground">
              <CalendarClock className="h-5 w-5" />
            </div>
            <p className="text-sm font-medium">No automations yet</p>
            <p className="max-w-xs text-pretty text-xs text-muted-foreground">
              Give the agent a standing instruction and a schedule — a weekday-morning inbox
              digest is a good first one.
            </p>
          </CardContent>
        </Card>
      ) : (
        automations.map((automation, i) => (
          <div key={automation.id} className="animate-in-up" style={{ animationDelay: `${i * 55}ms` }}>
            <AutomationCard automation={automation} onChanged={refresh} />
          </div>
        ))
      )}
    </div>
  );
}

function AutomationCard({
  automation,
  onChanged,
}: {
  automation: Automation;
  onChanged: () => Promise<void>;
}) {
  const [runs, setRuns] = React.useState<AutomationRun[] | null>(null);
  const [expanded, setExpanded] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const loadRuns = React.useCallback(async () => {
    setRuns(await api.automationRuns(automation.id).catch(() => []));
  }, [automation.id]);

  React.useEffect(() => {
    if (expanded) void loadRuns();
  }, [expanded, loadRuns]);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      await api.updateAutomation(automation.id, { enabled });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const runNow = async () => {
    setBusy(true);
    try {
      await api.runAutomation(automation.id);
      setExpanded(true);
      // Give the run a moment to be recorded before the first poll.
      setTimeout(() => void loadRuns(), 800);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete automation "${automation.name}"?`)) return;
    await api.deleteAutomation(automation.id);
    await onChanged();
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              {automation.name}
              <Badge variant="outline" className="font-mono text-[11px]">
                {automation.schedule}
              </Badge>
              {!automation.enabled && <Badge variant="secondary">paused</Badge>}
            </CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {automation.instruction}
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={automation.enabled}
              onCheckedChange={(v) => void toggle(v)}
              disabled={busy}
            />
            <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={busy}>
              <Play /> Run now
            </Button>
            <Button variant="ghost" size="icon" onClick={() => void remove()} title="Delete">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Recent runs
        </button>
        {expanded && (
          <div className="mt-2 flex flex-col gap-2">
            {!runs ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : runs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No runs yet.</p>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="rounded-md border bg-muted/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        run.status === "success"
                          ? "success"
                          : run.status === "error"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {run.status}
                    </Badge>
                    <time dateTime={run.startedAt} className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </time>
                  </div>
                  {run.result && (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs">{run.result}</p>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
