import * as React from "react";
import {
  BookOpen,
  CalendarClock,
  Inbox,
  Settings2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { isSetupComplete, type AppStatus } from "@trailin/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type View = "home" | "automations" | "knowledge" | "settings";

const NAV: { id: View; icon: LucideIcon }[] = [
  { id: "home", icon: Inbox },
  { id: "automations", icon: CalendarClock },
  { id: "knowledge", icon: BookOpen },
  { id: "settings", icon: Settings2 },
];

interface SidebarProps {
  active: View;
  onSelect: (view: View) => void;
  status: AppStatus | null;
  onClose: () => void;
}

export function Sidebar({ active, onSelect, status, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const setupIncomplete = status !== null && !isSetupComplete(status);

  return (
    <aside className="flex h-dvh w-64 shrink-0 flex-col bg-sidebar">
      <div className="flex items-center gap-2 px-3 pb-3 pt-4">
        <button 
          onClick={() => onSelect("home")} 
          className="shrink-0"
          title="Go to Homepage"
        >
          <img src="/logo.svg" alt="Trailin" className="h-8 w-auto object-contain transition-opacity hover:opacity-80" />
        </button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="ml-auto shrink-0 md:hidden"
          aria-label={t("sidebar.closeMenu")}
        >
          <X />
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 pt-4">
        {NAV.map(({ id, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              onClick={() => onSelect(id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent/12 text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {t(`views.${id}.title`)}
            </button>
          );
        })}
      </nav>

      {setupIncomplete && (
        <div className="mt-auto p-3">
          <button
            onClick={() => onSelect("settings")}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-warning transition-colors hover:bg-secondary"
          >
            <TriangleAlert className="h-4 w-4 shrink-0" />
            {t("sidebar.finishSetup")}
          </button>
        </div>
      )}
    </aside>
  );
}
