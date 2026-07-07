import * as React from "react";
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from "react-router-dom";
import { History, Menu, MessagesSquare, Moon, Sun, X, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isLanguage, isSetupComplete, type AppStatus } from "@trailin/shared";
import { Sidebar } from "@/components/Sidebar";
import { DockNav } from "@/components/DockNav";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { AutomationsPanel } from "@/features/automations/AutomationsPanel";
import { KnowledgePanel } from "@/features/knowledge/KnowledgePanel";
import { HomePanel } from "@/features/home/HomePanel";
import { SetupGate } from "@/features/setup/SetupGate";
import { Toaster } from "@/components/ui/toaster";
import { LoadingRow } from "@/components/ui/feedback";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { rememberLanguage } from "@/lib/i18n";
import { useResizableWidth } from "@/lib/useResizableWidth";
import { useNavLayout } from "@/lib/useNavLayout";

/** Set once setup finished (or was skipped); an established app never re-gates. */
const SETUP_DISMISSED_KEY = "trailin-setup-dismissed";

/** Adopt the server's language setting; on first run, seed it from the browser locale. */
function useServerLanguage() {
  const { i18n } = useTranslation();
  React.useEffect(() => {
    api
      .language()
      .then(({ language }) => {
        if (!language) {
          const current = i18n.language;
          if (isLanguage(current)) {
            rememberLanguage(current);
            void api.setLanguage(current).catch(() => {});
          }
          return;
        }
        rememberLanguage(language);
        if (language !== i18n.language) void i18n.changeLanguage(language);
      })
      .catch(() => {});
  }, [i18n]);
}

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
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  
  const currentPath = location.pathname.split("/")[1] || "home";
  const view = (["home", "automations", "knowledge", "settings"].includes(currentPath) ? currentPath : "home");
  const [status, setStatus] = React.useState<AppStatus | null>(null);
  // "pending" until the first status answer decides between gate and app.
  const [gate, setGate] = React.useState<"pending" | "open" | "closed">(() =>
    localStorage.getItem(SETUP_DISMISSED_KEY) ? "closed" : "pending",
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [chatOpen, setChatOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [theme, toggleTheme] = useTheme();
  const [navLayout] = useNavLayout();
  const { width: chatWidth, onPointerDown: onChatResizeStart } = useResizableWidth({
    storageKey: "trailin-chat-width",
    defaultWidth: 384,
    min: 320,
    max: 640,
    edge: "right",
  });
  useServerLanguage();

  const refreshStatus = React.useCallback(() => {
    api
      .status()
      .then(setStatus)
      .catch(() => {
        setStatus(null);
        // Never trap the user behind a gate the server can't answer.
        setGate((g) => (g === "pending" ? "closed" : g));
      });
  }, []);

  // Mount + whenever the tab regains focus (sign-in and account linking
  // happen in other tabs, and status must not go stale).
  React.useEffect(() => {
    refreshStatus();
    const onFocus = () => refreshStatus();
    const onVisible = () => {
      if (!document.hidden) refreshStatus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    const onShowChat = () => setChatOpen(true);
    window.addEventListener("trailin:show-chat", onShowChat);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("trailin:show-chat", onShowChat);
    };
  }, [refreshStatus]);

  React.useEffect(() => {
    if (!status) return;
    const complete = isSetupComplete(status);
    if (complete) localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    setGate((g) => (g === "pending" ? (complete ? "closed" : "open") : g));
  }, [status]);

  const select = (next: string) => {
    navigate(next === "home" ? "/" : `/${next}`);
    setMobileOpen(false);
    setChatOpen(false);
  };

  const closeGate = (openSettings: boolean) => {
    localStorage.setItem(SETUP_DISMISSED_KEY, "1");
    setGate("closed");
    select(openSettings ? "settings" : "home");
  };

  if (gate === "open" && status) {
    return (
      <>
        <SetupGate status={status} onStatusChanged={refreshStatus} onFinish={closeGate} />
        <Toaster />
      </>
    );
  }

  if (gate === "pending") {
    return (
      <div className="grid h-dvh place-items-center">
        <LoadingRow />
      </div>
    );
  }

  const meta = {
    title: t(`views.${view}.title` as any),
    description: t(`views.${view}.description` as any),
  };

  return (
    <div
      className="flex h-dvh overflow-hidden"
      style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md"
      >
        {t("app.skipToContent")}
      </a>

      {navLayout === "sidebar" && mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {navLayout === "sidebar" && (
        <div
          className={cn(
            "fixed inset-y-0 left-0 z-50 shadow-lg transition-transform duration-200 ease-out md:static md:z-auto md:translate-x-0 md:shadow-none",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <Sidebar
            status={status}
            onClose={() => setMobileOpen(false)}
          />
        </div>
      )}

      {/* Floating Dock Nav — centered over the content column, not the viewport */}
      {navLayout === "dock" && <DockNav status={status} theme={theme} />}

      <main
        id="main-content"
        className="flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        <header className="flex shrink-0 items-center gap-4 px-5 py-5 sm:px-8">
          {navLayout === "dock" && (
            <Link to="/" title="Go to Homepage" className="shrink-0 flex items-center">
              <img src="/logo.svg" alt="Trailin" className="h-8 w-auto object-contain transition-opacity hover:opacity-80" />
            </Link>
          )}
          {navLayout === "sidebar" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                setChatOpen(false);
                setMobileOpen(true);
              }}
              className="shrink-0 md:hidden"
              aria-label={t("app.openMenu")}
            >
              <Menu />
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{meta.title}</h1>
            <p className="truncate text-sm text-muted-foreground">{meta.description}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="ml-auto shrink-0"
            aria-label={theme === "dark" ? t("sidebar.lightMode") : t("sidebar.darkMode")}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setMobileOpen(false);
              setChatOpen(true);
            }}
            className="shrink-0 md:hidden"
            aria-label={t("app.openChat")}
          >
            <MessagesSquare />
          </Button>
        </header>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto scroll-stable px-5 pt-1 sm:px-8",
            navLayout === "dock" ? "pb-28" : "pb-10",
          )}
        >
          <div
            className={cn(
              "mx-auto max-w-3xl",
              // Dock mode: chat is a floating overlay, so content stays viewport-centered.
              // Cap its width so it shrinks symmetrically rather than sliding under the chat.
              navLayout === "dock" &&
                "md:max-w-[max(20rem,min(48rem,calc(100vw_-_2*var(--chat-width)_-_4rem)))]",
            )}
          >
            <Routes>
              <Route path="/settings" element={<SettingsPanel onStatusChanged={refreshStatus} />} />
              <Route path="/automations" element={<AutomationsPanel />} />
              <Route path="/knowledge" element={<KnowledgePanel />} />
              <Route 
                path="/" 
                element={
                  <HomePanel
                    setupIncomplete={status !== null && !isSetupComplete(status)}
                    onNavigate={select}
                  />
                } 
              />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </div>
      </main>

      {/* Chat backdrop — mobile only, chat is a slide-over there */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
          onClick={() => setChatOpen(false)}
        />
      )}

      {/* Drag handle — desktop only. In dock mode the chat floats (fixed, doesn't
          shift the page), so the handle floats at its left edge too; in sidebar mode
          the chat is in flow, so the handle sits in the flow beside it. */}
      <div
        onPointerDown={onChatResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resize")}
        className={cn(
          "group z-40 hidden cursor-col-resize touch-none items-center justify-center md:flex",
          navLayout === "dock"
            ? "fixed inset-y-0 right-[var(--chat-width)] w-4"
            : "w-2 shrink-0",
        )}
      >
        <div className="h-8 w-1 rounded-full bg-foreground/10 transition-colors group-hover:bg-foreground/30 group-active:bg-accent/60" />
      </div>

      {/* Chat — floating overlay on desktop (fixed, so it never shifts the page's centering), slide-over on mobile */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 flex w-full max-w-sm flex-col transition-transform duration-200 ease-out md:w-[var(--chat-width)] md:max-w-none md:translate-x-0",
          chatOpen ? "z-50 translate-x-0" : "z-40 translate-x-full md:translate-x-0",
          navLayout === "dock" ? "md:fixed md:z-40 md:py-4 md:pr-4 md:pointer-events-none" : "md:static md:z-auto",
        )}
        style={{ "--chat-width": `${chatWidth}px` } as React.CSSProperties}
      >
        <div className={cn(
          "flex flex-1 flex-col overflow-hidden pointer-events-auto",
          navLayout === "dock" ? "md:bg-white dark:md:bg-sidebar md:rounded-2xl" : "h-full bg-sidebar"
        )}>
          <div className="flex shrink-0 items-center gap-2.5 px-5 pb-4 pt-6">
          <p className="text-sm font-semibold tracking-tight">{t("views.chat.title")}</p>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.dispatchEvent(new CustomEvent("trailin:new-chat"))}
            className="ml-auto"
            aria-label={t("chat.newConversation")}
            title={t("chat.newConversation")}
          >
            <SquarePen />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setHistoryOpen((open) => !open)}
            className={cn(historyOpen && "text-foreground")}
            aria-label={t("chat.history")}
          >
            <History />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setChatOpen(false)}
            className="md:hidden"
            aria-label={t("app.closeChat")}
          >
            <X />
          </Button>
          </div>
          <div className="min-h-0 flex-1 px-5 pb-5">
            <ChatPanel historyOpen={historyOpen} setHistoryOpen={setHistoryOpen} />
          </div>
        </div>
      </div>

      <Toaster />
    </div>
  );
}
