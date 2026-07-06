import * as React from "react";
import {
  CalendarClock,
  MessageSquare,
  Moon,
  Settings2,
  Sun,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type View = "chat" | "automations" | "settings";

export const NAV: { id: View; label: string; icon: LucideIcon }[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "automations", label: "Automations", icon: CalendarClock },
  { id: "settings", label: "Settings", icon: Settings2 },
];

interface SidebarProps {
  active: View;
  onSelect: (view: View) => void;
  status: {
    modelConfigured: boolean;
    pipedreamConfigured: boolean;
    provider: string;
    model: string;
  } | null;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onClose: () => void;
}

export function Sidebar({ active, onSelect, status, theme, onToggleTheme, onClose }: SidebarProps) {
  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col bg-sidebar">
      <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Waypoints className="h-[18px] w-[18px]" />
        </div>
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold tracking-tight">Trailin</p>
          <p className="truncate text-xs text-muted-foreground">Local email agent</p>
        </div>
        <button
          onClick={onClose}
          className="ml-auto grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
          Workspace
        </p>
        {NAV.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {isActive && (
                <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 border-t px-3 py-3">
        <div className="rounded-lg bg-background/50 px-3 py-2">
          <StatusRow
            label="Model"
            ok={status?.modelConfigured}
            okText={status?.model ?? "Connected"}
            badText="Sign in required"
          />
          <StatusRow
            label="Email"
            ok={status?.pipedreamConfigured}
            okText="Ready"
            badText="Not configured"
          />
        </div>
        <button
          onClick={onToggleTheme}
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>
    </aside>
  );
}

function StatusRow({
  label,
  ok,
  okText,
  badText,
}: {
  label: string;
  ok: boolean | undefined;
  okText: string;
  badText: string;
}) {
  const pending = ok === undefined;
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            pending ? "bg-muted-foreground/40" : ok ? "bg-emerald-500" : "bg-amber-500",
          )}
        />
        <span
          className={cn(
            "max-w-[120px] truncate",
            pending
              ? "text-muted-foreground"
              : ok
                ? "text-foreground"
                : "text-amber-600 dark:text-amber-400",
          )}
          title={pending ? undefined : ok ? okText : badText}
        >
          {pending ? "Checking…" : ok ? okText : badText}
        </span>
      </span>
    </div>
  );
}
