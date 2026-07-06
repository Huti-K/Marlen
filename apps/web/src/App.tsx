import * as React from "react";
import { Menu } from "lucide-react";
import type { AppStatus } from "@trailin/shared";
import { Sidebar, type View } from "@/components/Sidebar";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { AutomationsPanel } from "@/features/automations/AutomationsPanel";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

const VIEW_META: Record<View, { title: string; description: string }> = {
  chat: {
    title: "Chat",
    description: "Ask about your inbox, or tell the agent to draft, label, or clean up mail.",
  },
  automations: {
    title: "Automations",
    description: "Run the agent on a schedule with a standing instruction.",
  },
  settings: {
    title: "Settings",
    description: "Model, LLM provider sign-in, and email accounts.",
  },
};

function useTheme() {
  const [theme, setTheme] = React.useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    const saved = localStorage.getItem("trailin-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("trailin-theme", theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === "dark" ? "light" : "dark"))] as const;
}

export default function App() {
  const [view, setView] = React.useState<View>("chat");
  const [status, setStatus] = React.useState<AppStatus | null>(null);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [theme, toggleTheme] = useTheme();

  const refreshStatus = React.useCallback(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  React.useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const select = (next: View) => {
    setView(next);
    setMobileOpen(false);
  };

  const meta = VIEW_META[view];

  return (
    <div className="flex h-dvh overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md"
      >
        Skip to content
      </a>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — static on desktop, slide-over on mobile */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 border-r transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar
          active={view}
          onSelect={select}
          status={status}
          theme={theme}
          onToggleTheme={toggleTheme}
          onClose={() => setMobileOpen(false)}
        />
      </div>

      <main id="main-content" className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground md:hidden"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-semibold tracking-tight">{meta.title}</h1>
            <p className="truncate text-sm text-muted-foreground">{meta.description}</p>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          {view === "chat" ? (
            <div className="h-full px-4 py-4 sm:px-6">
              <ChatPanel />
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto max-w-3xl">
                {view === "settings" ? (
                  <SettingsPanel onStatusChanged={refreshStatus} />
                ) : (
                  <AutomationsPanel />
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
