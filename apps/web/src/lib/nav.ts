import {
  BookOpen,
  CalendarClock,
  Inbox,
  type LucideIcon,
  MessagesSquare,
  Palette,
  Settings2,
  Users,
} from "lucide-react";

export type View = "home" | "chat" | "leads" | "automations" | "knowledge" | "settings";

interface NavItem {
  id: View;
  path: string;
  icon: LucideIcon;
  /** Shown only while onOffice is connected — the lead workflow exists only alongside the CRM. */
  requiresOnOffice?: boolean;
}

/**
 * Single source of truth for the primary nav. The Sidebar, the
 * command palette's shortcut list, and App.tsx's route-name validation all
 * read from this one array instead of keeping their own copies in sync.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "home", path: "/", icon: Inbox },
  { id: "chat", path: "/chat", icon: MessagesSquare },
  { id: "leads", path: "/leads", icon: Users, requiresOnOffice: true },
  { id: "automations", path: "/automations", icon: CalendarClock },
  { id: "knowledge", path: "/knowledge", icon: BookOpen },
  { id: "settings", path: "/settings", icon: Settings2 },
];

export const NAV_VIEWS: View[] = NAV_ITEMS.map((item) => item.id);

/**
 * The nav as the current install shows it: items behind requiresOnOffice
 * appear only once the CRM is connected. Sidebar and palette both render
 * from this, so a hidden view never surfaces in either.
 */
export function visibleNavItems(onofficeConfigured: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.requiresOnOffice || onofficeConfigured);
}

/**
 * DEV showcase — deliberately not a NAV_ITEM: it never appears in the sidebar
 * or the palette's shortcut list, only as a match for a typed palette query
 * (or by visiting /showcase directly). Dev-only, so the copy stays
 * untranslated. Delete with the /showcase route.
 */
export const SHOWCASE_NAV = {
  id: "showcase",
  path: "/showcase",
  icon: Palette,
  title: "UI Showcase",
  description: "Component gallery & theme lab (dev only)",
} as const;

/**
 * Navigation from non-React code (e.g. a toast's click-through action). App
 * registers its router navigate once; module-level code calls appNavigate.
 */
let navigateListener: ((path: string) => void) | null = null;

export function registerNavigate(listener: (path: string) => void): () => void {
  navigateListener = listener;
  return () => {
    if (navigateListener === listener) navigateListener = null;
  };
}

export function appNavigate(path: string): void {
  navigateListener?.(path);
}

/** Open the Cmd+K search palette; its single instance registers itself. */
let openSearchListener: (() => void) | null = null;

export function registerOpenSearch(listener: () => void): () => void {
  openSearchListener = listener;
  return () => {
    if (openSearchListener === listener) openSearchListener = null;
  };
}

export function openSearch(): void {
  openSearchListener?.();
}
