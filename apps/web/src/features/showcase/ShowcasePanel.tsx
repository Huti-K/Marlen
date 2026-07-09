/*
 * ─────────────────────────────────────────────────────────────────────────────
 *  DEV SHOWCASE / THEME LAB — safe to delete.
 *
 *  A single self-contained gallery of every UI primitive plus a live theme
 *  editor. Colleagues can retune the palette here (the "colours are dark and
 *  depressed" note) and copy the result straight into `src/index.css`.
 *
 *  To remove entirely: delete this file and the one `/showcase` <Route> in
 *  App.tsx. Nothing else imports it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import * as React from "react";
import {
  Bell,
  Check,
  Copy,
  Inbox,
  Loader2,
  Mail,
  Moon,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ListRow } from "@/components/ui/list-row";
import { FormField } from "@/components/ui/form-field";
import { SectionHeader, Section } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner, LoadingRow } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { IconButton } from "@/components/ui/icon-button";
import { LinkButton } from "@/components/ui/link-button";
import { ColorPicker } from "@/components/ui/color-picker";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type ThemeName = "light" | "dark";

/** Colour tokens the editor exposes as pickers, in render order. */
const COLOR_TOKENS: { name: string; label: string }[] = [
  { name: "--background", label: "Background" },
  { name: "--surface", label: "Surface" },
  { name: "--surface-2", label: "Surface 2" },
  { name: "--foreground", label: "Foreground" },
  { name: "--muted-foreground", label: "Muted text" },
  { name: "--primary", label: "Primary (ink)" },
  { name: "--accent", label: "Accent" },
  { name: "--success", label: "Success" },
  { name: "--warning", label: "Warning" },
  { name: "--destructive", label: "Destructive" },
];

/** Every token shown in the read-only palette strip. */
const ALL_TOKENS: { name: string; label: string }[] = [
  ...COLOR_TOKENS,
  { name: "--secondary", label: "Secondary" },
  { name: "--accent-soft", label: "Accent soft" },
  { name: "--ring", label: "Ring" },
  { name: "--sidebar", label: "Sidebar" },
];

type Overrides = Record<ThemeName, Record<string, string>>;

/** Ready-made palettes that counter the "dark and depressed" feedback. */
const PRESETS: { name: string; overrides: Overrides }[] = [
  {
    name: "Warmer paper",
    overrides: {
      light: {
        "--background": "#f7f4ee",
        "--surface": "#fffdf8",
        "--surface-2": "#ece7dd",
        "--foreground": "#2c2823",
        "--accent": "#4f66cf",
      },
      dark: {
        "--background": "#221f1b",
        "--surface": "#2b2722",
        "--surface-2": "#343029",
        "--foreground": "#f2eee6",
        "--accent": "#8ba0f2",
      },
    },
  },
  {
    name: "Vivid & bright",
    overrides: {
      light: {
        "--background": "#fbfbfd",
        "--surface": "#ffffff",
        "--surface-2": "#eef0f6",
        "--accent": "#4f46e5",
        "--primary": "#1f2430",
      },
      dark: {
        "--background": "#1b2130",
        "--surface": "#242c3e",
        "--surface-2": "#2e3850",
        "--foreground": "#eef1f8",
        "--accent": "#7f8cff",
      },
    },
  },
];

const DEFAULT_RADIUS = 0.7;

/**
 * Normalise any CSS colour string (`rgb()`, `oklch()`, `color(srgb …)`, a name)
 * to `#rrggbb`. Rather than parse the string — browsers serialise computed
 * colours inconsistently and some round-trip `oklch()` verbatim — we *paint* it
 * onto a 1×1 canvas and read the rasterised sRGB pixel back, which converts any
 * colour space for us.
 */
let canvasCtx: CanvasRenderingContext2D | null = null;
function toHex(cssColor: string): string {
  if (!canvasCtx) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    canvasCtx = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!canvasCtx) return "#888888";
  canvasCtx.clearRect(0, 0, 1, 1);
  canvasCtx.fillStyle = cssColor;
  canvasCtx.fillRect(0, 0, 1, 1);
  const d = canvasCtx.getImageData(0, 0, 1, 1).data;
  return "#" + [d[0], d[1], d[2]].map((n) => (n ?? 0).toString(16).padStart(2, "0")).join("");
}

/**
 * Resolve a CSS var's *base* value for a given theme (ignoring any inline
 * override on <html>) by probing inside a throwaway themed host and reading the
 * used colour back through {@link toHex}.
 */
function resolveToken(name: string, theme: ThemeName): string {
  const host = document.createElement("div");
  host.className = theme; // matches `:root, .light` / `.dark` in index.css
  host.style.position = "absolute";
  host.style.visibility = "hidden";
  host.style.pointerEvents = "none";
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  host.appendChild(probe);
  document.body.appendChild(host);
  const hex = toHex(getComputedStyle(probe).color);
  document.body.removeChild(host);
  return hex;
}

export function ShowcasePanel() {
  const [theme, setTheme] = React.useState<ThemeName>(() => {
    // App applies the `dark` class in an effect (after our first render), so read
    // the persisted preference it also seeds from to avoid a light/dark desync.
    const saved = localStorage.getItem("trailin-theme");
    if (saved === "dark" || saved === "light") return saved;
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  });
  const [overrides, setOverrides] = React.useState<Overrides>({ light: {}, dark: {} });
  const [radius, setRadius] = React.useState(DEFAULT_RADIUS);
  const [base, setBase] = React.useState<Record<ThemeName, Record<string, string>> | null>(null);

  // Stay in lockstep with the real theme, whichever control flips it.
  React.useEffect(() => {
    const el = document.documentElement;
    const sync = () => setTheme(el.classList.contains("dark") ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Resolve each theme's true default once, for seeding pickers + reset.
  React.useEffect(() => {
    const next: Record<ThemeName, Record<string, string>> = { light: {}, dark: {} };
    for (const theme of ["light", "dark"] as ThemeName[]) {
      for (const { name } of ALL_TOKENS) next[theme][name] = resolveToken(name, theme);
    }
    setBase(next);
  }, []);

  // Push the active theme's colour overrides onto <html> for a live preview;
  // clear any token the current theme no longer overrides.
  React.useEffect(() => {
    const root = document.documentElement.style;
    for (const { name } of COLOR_TOKENS) {
      const value = overrides[theme][name];
      if (value) root.setProperty(name, value);
      else root.removeProperty(name);
    }
  }, [overrides, theme]);

  React.useEffect(() => {
    document.documentElement.style.setProperty("--radius", `${radius}rem`);
  }, [radius]);

  // Leave the rest of the app exactly as we found it.
  React.useEffect(
    () => () => {
      const root = document.documentElement.style;
      for (const { name } of COLOR_TOKENS) root.removeProperty(name);
      root.removeProperty("--radius");
    },
    [],
  );

  const toggleTheme = () =>
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("trailin-theme", next);
      } catch {
        /* ignore */
      }
      return next;
    });

  const setToken = (name: string, hex: string) =>
    setOverrides((prev) => ({
      ...prev,
      [theme]: { ...prev[theme], [name]: hex },
    }));

  const applyPreset = (preset: Overrides) => {
    setOverrides({ light: { ...preset.light }, dark: { ...preset.dark } });
  };

  const reset = () => {
    setOverrides({ light: {}, dark: {} });
    setRadius(DEFAULT_RADIUS);
  };

  const colorFor = (theme: ThemeName, name: string) =>
    overrides[theme][name] ?? base?.[theme][name] ?? "#888888";

  const copyCss = async () => {
    const block = (theme: ThemeName) => {
      const entries = Object.entries(overrides[theme]);
      if (!entries.length) return "";
      const lines = entries.map(([k, v]) => `  ${k}: ${v};`).join("\n");
      const selector = theme === "light" ? ":root, .light" : ".dark";
      return `${selector} {\n${lines}\n}`;
    };
    const parts = [block("light"), block("dark")].filter(Boolean);
    if (radius !== DEFAULT_RADIUS) parts.push(`:root {\n  --radius: ${radius}rem;\n}`);
    const css = parts.join("\n\n");
    if (!css) {
      toast.error("Nothing to copy — no overrides yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(css);
      toast.success("Theme CSS copied to clipboard.");
    } catch {
      toast.error("Clipboard blocked — copy manually from the preview below.");
    }
  };

  const dirtyCount =
    Object.keys(overrides.light).length + Object.keys(overrides.dark).length;

  return (
    <div className="flex flex-col gap-10 pb-16">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" />
          <h1 className="text-lg font-semibold tracking-tight">UI Showcase &amp; Theme Lab</h1>
          <Badge variant="warning">dev only</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Every component in one place, plus a live palette editor. Tune colours until they
          feel right, then <span className="font-medium text-foreground">Copy CSS</span> into{" "}
          <span className="font-mono text-xs">src/index.css</span>. Delete this file and its
          route to remove.
        </p>
      </div>

      {/* ── Theme Lab ─────────────────────────────────────────────── */}
      <Card tone="soft" padding="lg" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-semibold tracking-tight">Theme Lab</p>
          <Button variant="outline" size="sm" onClick={toggleTheme}>
            {theme === "dark" ? <Sun /> : <Moon />}
            Editing: {theme}
          </Button>
          {PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant="secondary"
              size="sm"
              onClick={() => applyPreset(preset.overrides)}
            >
              {preset.name}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={reset} disabled={dirtyCount === 0}>
            <RotateCcw /> Reset
          </Button>
          <Button size="sm" onClick={() => void copyCss()}>
            <Copy /> Copy CSS{dirtyCount > 0 ? ` (${dirtyCount})` : ""}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Editing the <span className="font-medium text-foreground">{theme}</span> theme —
          switch with the button above to tune the other. Changes preview across the whole app
          and revert when you leave this page.
        </p>

        {base ? (
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {COLOR_TOKENS.map(({ name, label }) => (
              <div key={name} className="flex items-center gap-3">
                <ColorPicker color={colorFor(theme, name)} onSelect={(hex) => setToken(name, hex)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{label}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">{name}</p>
                </div>
                <span className="font-mono text-[11px] uppercase text-muted-foreground">
                  {colorFor(theme, name)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <LoadingRow label="Reading current palette…" />
        )}

        <div className="flex items-center gap-4">
          <Label htmlFor="sc-radius" className="w-28 shrink-0">
            Corner radius
          </Label>
          <input
            id="sc-radius"
            type="range"
            min={0}
            max={1.4}
            step={0.05}
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
            {radius.toFixed(2)}rem
          </span>
        </div>
      </Card>

      {/* ── Palette swatches ──────────────────────────────────────── */}
      <Section title="Palette" description="Every token in the current theme.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {base &&
            ALL_TOKENS.map(({ name, label }) => (
              <div key={name} className="flex items-center gap-2.5">
                <span
                  className="h-9 w-9 shrink-0 rounded-lg shadow-sm"
                  style={{ background: colorFor(theme, name) }}
                />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{label}</p>
                  <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
                    {colorFor(theme, name)}
                  </p>
                </div>
              </div>
            ))}
        </div>
      </Section>

      {/* ── Buttons ───────────────────────────────────────────────── */}
      <Section title="Buttons" description="Ink primary, tonal fills, no outlines. Hover over the icon buttons below to see the custom cursor tooltip in action.">
        <div className="flex flex-wrap items-center gap-3">
          <Button data-tooltip="Default solid button">Default</Button>
          <Button variant="secondary" data-tooltip="Secondary style">Secondary</Button>
          <Button variant="outline" data-tooltip="Outline style">Outline</Button>
          <Button variant="ghost" data-tooltip="Ghost style">Ghost</Button>
          <Button variant="destructive" data-tooltip="Warning: destructive action">
            <Trash2 /> Destructive
          </Button>
          <Button disabled data-tooltip="This is currently disabled">Disabled</Button>
          <Button>
            <Loader2 className="animate-spin" /> Loading
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="default">Default</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" aria-label="Notifications">
            <Bell />
          </Button>
          <IconButton aria-label="Dismiss row">
            <Bell className="h-4 w-4" />
          </IconButton>
          <LinkButton data-tooltip="Goes somewhere else">Link button</LinkButton>
        </div>
      </Section>

      {/* ── Badges ────────────────────────────────────────────────── */}
      <Section title="Badges" description="Pill status chips — pastel fill, no border.">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>Default</Badge>
          <Badge variant="muted">Muted</Badge>
          <Badge variant="success">
            <Check className="h-3 w-3" /> Connected
          </Badge>
          <Badge variant="warning">Paused</Badge>
          <Badge variant="destructive">Error</Badge>
        </div>
      </Section>

      {/* ── Switches ──────────────────────────────────────────────── */}
      <Section title="Switches" description="Accent by default; warning/danger arm risky actions.">
        <div className="flex flex-wrap items-center gap-6">
          <SwitchDemo label="Accent" tone="accent" defaultOn />
          <SwitchDemo label="Warning" tone="warning" defaultOn />
          <SwitchDemo label="Danger" tone="danger" defaultOn />
          <SwitchDemo label="Off" tone="accent" />
          <div className="flex items-center gap-2 opacity-60">
            <Switch disabled />
            <span className="text-sm">Disabled</span>
          </div>
        </div>
        <DangerZoneDemo />
      </Section>

      {/* ── Form controls ─────────────────────────────────────────── */}
      <Section title="Form controls" description="Filled fields, no borders; focus lightens the fill.">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id="sc-name" label="Full name" hint="As it appears on your account.">
            <Input id="sc-name" placeholder="Ada Lovelace" />
          </FormField>
          <FormField id="sc-email" label="Email" error="That address looks invalid.">
            <Input id="sc-email" type="email" defaultValue="not-an-email" />
          </FormField>
          <FormField id="sc-plan" label="Plan">
            <SelectDemo />
          </FormField>
          <FormField id="sc-disabled" label="Disabled">
            <Input id="sc-disabled" disabled defaultValue="Read-only" />
          </FormField>
          <FormField id="sc-note" label="Note" className="sm:col-span-2">
            <Textarea id="sc-note" placeholder="Write something…" rows={3} />
          </FormField>
        </div>
      </Section>

      {/* ── Cards & rows ──────────────────────────────────────────── */}
      <Section title="Surfaces" description="Three tones by depth — never a border, never card-in-card.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card tone="flat">
            <p className="text-sm font-medium">Flat card</p>
            <p className="text-xs text-muted-foreground">surface + soft shadow.</p>
          </Card>
          <Card tone="soft">
            <p className="text-sm font-medium">Soft card</p>
            <p className="text-xs text-muted-foreground">The one elevated panel.</p>
          </Card>
        </div>
        <div className="flex flex-col gap-2">
          <ListRow>
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Gmail — personal</span>
            </div>
            <Badge variant="success">Connected</Badge>
          </ListRow>
          <ListRow>
            <div className="flex items-center gap-3">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm">Outlook — work</span>
            </div>
            <Badge variant="warning">Reconnect</Badge>
          </ListRow>
        </div>
      </Section>

      {/* ── Toasts ────────────────────────────────────────────────── */}
      <Section title="Toasts" description="Ephemeral system notifications that slide in.">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => toast.success("Your changes have been saved.")} variant="secondary">
            Success toast
          </Button>
          <Button onClick={() => toast.error("Could not connect to the server.")} variant="secondary">
            Error toast
          </Button>
        </div>
      </Section>

      {/* ── Status tints ──────────────────────────────────────────── */}
      <Section title="Status tints" description="The one place semantic colour fills a shape.">
        <div className="flex flex-wrap gap-2">
          {(["tint-neutral", "tint-accent", "tint-success", "tint-warning", "tint-danger"] as const).map(
            (tint) => (
              <span key={tint} className={cn(tint, "rounded-lg px-3 py-1.5 text-xs font-medium")}>
                {tint.replace("tint-", "")}
              </span>
            ),
          )}
        </div>
        <ErrorBanner>Something went wrong while saving your changes.</ErrorBanner>
      </Section>

      {/* ── Feedback & empty ──────────────────────────────────────── */}
      <Section title="Feedback & empty states" description="Loading, skeletons, and the nothing-here shape.">
        <LoadingRow label="Loading your drafts…" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <EmptyState
            icon={Inbox}
            title="No drafts yet"
            description="When the agent writes a draft, it shows up here for review."
            action={<Button size="sm">Compose one</Button>}
          />
          <EmptyState
            size="lg"
            icon={Sparkles}
            title="All caught up"
            description="Nothing needs your attention right now."
          />
        </div>
      </Section>

      {/* ── Typography ────────────────────────────────────────────── */}
      <Section title="Typography" description="Hierarchy by weight and colour, not size jumps.">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-lg font-semibold tracking-tight">Heading — text-lg semibold</h1>
          <h2 className="text-sm font-semibold tracking-tight">Section title — text-sm semibold</h2>
          <p className="text-sm">Body text sits on the foreground ink, never pure black.</p>
          <p className="text-sm text-muted-foreground">Secondary text uses muted-foreground.</p>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            mono · 09:41 · model_id · proj_abc123
          </p>
        </div>
      </Section>
    </div>
  );
}

function SwitchDemo({
  label,
  tone,
  defaultOn,
}: {
  label: string;
  tone: "accent" | "warning" | "danger";
  defaultOn?: boolean;
}) {
  const [on, setOn] = React.useState(Boolean(defaultOn));
  return (
    <div className="flex items-center gap-2">
      <Switch tone={tone} checked={on} onCheckedChange={setOn} />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Mirrors the real "allow sending" danger-zone row so it can be tuned here. */
function DangerZoneDemo() {
  const [armed, setArmed] = React.useState(false);
  return (
    <ListRow className={cn("transition-colors", armed && "bg-warning/10")}>
      <div className="min-w-0">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          {armed && <Sparkles className="h-3.5 w-3.5 shrink-0 text-warning" />}
          Allow sending &amp; changes
        </Label>
        <p className={cn("text-xs", armed ? "text-warning" : "text-muted-foreground")}>
          {armed
            ? "The agent may send emails and make changes when you ask."
            : "Read-only: the agent can draft but never send or delete."}
        </p>
      </div>
      <Switch tone="warning" checked={armed} onCheckedChange={setArmed} />
    </ListRow>
  );
}

function SelectDemo() {
  const [value, setValue] = React.useState("pro");
  return (
    <Select
      id="sc-plan"
      value={value}
      onChange={setValue}
      options={[
        { value: "free", label: "Free" },
        { value: "pro", label: "Pro" },
        { value: "team", label: "Team" },
      ]}
    />
  );
}
