import * as React from "react";
import { Link, useLocation } from "react-router-dom";
import { Palette, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isSetupComplete, type AppStatus } from "@trailin/shared";
import { Badge } from "@/components/ui/badge";
import { NAV_ITEMS } from "@/lib/nav";
import { cn } from "@/lib/utils";

interface DockNavProps {
  status: AppStatus | null;
  theme?: "light" | "dark";
}

export function DockNav({ status, theme }: DockNavProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const setupIncomplete = status !== null && !isSetupComplete(status);

  // Inverse theme logic: if the app is light, dock is dark. If app is dark, dock is light.
  const inverseThemeClass = theme === "light" ? "dark" : "light";

  return (
    <div className={cn("fixed bottom-6 left-1/2 z-50 -translate-x-1/2", inverseThemeClass)}>
      <nav className="flex items-center gap-1.5 rounded-full bg-background/95 px-3 py-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.4)] backdrop-blur-md">
        {status?.demo && (
          <>
            <Badge variant="muted" className="ml-1 shrink-0">
              {t("sidebar.demoBadge")}
            </Badge>
            <div className="mx-1 h-6 w-px bg-border"></div>
          </>
        )}
        {NAV_ITEMS.map(({ id, path, icon: Icon }) => {
          const isActive = location.pathname === path || (path !== "/" && location.pathname.startsWith(path));
          return (
            <Link
              key={id}
              to={path}
              aria-current={isActive ? "page" : undefined}
              title={t(`views.${id}.title`)}
              className={cn(
                "group relative flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {/* Only show label on desktop or when active, otherwise just icon to save space. For settings, always hide label. */}
              {id !== "settings" && (
                <span className={cn(
                  "ml-2 overflow-hidden transition-all duration-200",
                  isActive ? "max-w-[100px] opacity-100" : "max-w-0 opacity-0 md:max-w-[100px] md:opacity-100"
                )}>
                  {t(`views.${id}.title`)}
                </span>
              )}
            </Link>
          );
        })}

        {/* DEV showcase — delete this block with the /showcase route. */}
        {import.meta.env.DEV && (
          <Link
            to="/showcase"
            aria-current={location.pathname.startsWith("/showcase") ? "page" : undefined}
            title="Showcase"
            className={cn(
              "group relative flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium transition-all duration-200",
              location.pathname.startsWith("/showcase")
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <Palette className="h-4 w-4 shrink-0" />
          </Link>
        )}

        {setupIncomplete && (
          <>
            <div className="mx-1 h-6 w-px bg-border"></div>
            <Link
              to="/settings"
              className="flex h-10 w-10 items-center justify-center rounded-full text-warning hover:bg-warning/10 transition-colors"
              title={t("sidebar.finishSetup")}
            >
              <TriangleAlert className="h-5 w-5 shrink-0 animate-pulse" />
            </Link>
          </>
        )}
      </nav>
    </div>
  );
}
