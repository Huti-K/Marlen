import {
  BookOpen,
  CalendarClock,
  Inbox,
  type LucideIcon,
  Mail,
  MessagesSquare,
  Palette,
  Settings2,
  Users,
} from "lucide-react";

export type View =
  | "home"
  | "chat"
  | "email"
  | "automations"
  | "contacts"
  | "knowledge"
  | "settings";

export interface NavItem {
  id: View;
  path: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for the primary nav. The Sidebar, the
 * command palette's shortcut list, and App.tsx's route-name validation all
 * read from this one array instead of keeping their own copies in sync.
 */
export const NAV_ITEMS: NavItem[] = [
  { id: "home", path: "/", icon: Inbox },
  { id: "chat", path: "/chat", icon: MessagesSquare },
  { id: "email", path: "/email", icon: Mail },
  { id: "automations", path: "/automations", icon: CalendarClock },
  { id: "contacts", path: "/contacts", icon: Users },
  { id: "knowledge", path: "/knowledge", icon: BookOpen },
  { id: "settings", path: "/settings", icon: Settings2 },
];

export const NAV_VIEWS: View[] = NAV_ITEMS.map((item) => item.id);

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
