import { CalendarClock, ChevronLeft, ChevronRight, X } from "lucide-react";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DAY_MS, dayIso, dueChip, parseDue, startOfDayMs } from "@/features/home/agenda";
import { cn } from "@/lib/utils";

const p2 = (n: number) => String(n).padStart(2, "0");

/**
 * Due date/time picker for a todo: a trigger button showing the current due,
 * opening an anchored panel with quick picks (today / tomorrow / in a week /
 * none), a Monday-first month grid, and an optional time. Every pick calls
 * onChange immediately (auto-save); a date-only pick stays date-only until a
 * time is set, and clearing the date clears the time with it.
 */
export function DueDatePicker({
  dueAt,
  lang,
  onChange,
}: {
  dueAt: string | null;
  lang: string;
  onChange: (dueAt: string | null) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const todayStart = startOfDayMs(new Date());
  const due = dueAt ? parseDue(dueAt) : null;
  const selectedIso = due ? dayIso(startOfDayMs(due.at)) : null;
  const time = due && !due.dateOnly ? `${p2(due.at.getHours())}:${p2(due.at.getMinutes())}` : "";
  const [view, setView] = React.useState(() => {
    const base = due?.at ?? new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open) {
      const base = due?.at ?? new Date();
      setView({ y: base.getFullYear(), m: base.getMonth() });
    }
    setOpen((v) => !v);
  };

  const compose = (dateIso: string | null, timeStr: string) =>
    dateIso ? (timeStr ? `${dateIso}T${timeStr}` : dateIso) : null;
  const pickDay = (iso: string) => onChange(compose(iso, time));
  // A time without a date anchors to today.
  const pickTime = (v: string) => onChange(compose(selectedIso ?? dayIso(todayStart), v));
  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  // Monday-first weekday headers from the locale (2024-01-01 is a Monday).
  const weekdays = React.useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) =>
      fmt
        .format(new Date(2024, 0, 1 + i))
        .replace(".", "")
        .slice(0, 2),
    );
  }, [lang]);
  const monthLabel = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(
    new Date(view.y, view.m, 1),
  );
  const lead = (new Date(view.y, view.m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();

  const quicks = [
    { label: t("home.todosToday"), iso: dayIso(todayStart) },
    { label: t("home.todosTomorrow"), iso: dayIso(todayStart + DAY_MS) },
    { label: t("home.todosDueNextWeek"), iso: dayIso(todayStart + 7 * DAY_MS) },
  ];

  const triggerLabel = dueAt
    ? dueChip(dueAt, lang, todayStart, { dayContext: false }).text
    : t("home.todosDueNone");

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="secondary"
        size="sm"
        aria-label={t("home.todosDueDate")}
        aria-expanded={open}
        onClick={toggle}
      >
        <CalendarClock />
        <span className="tabular-nums">{triggerLabel}</span>
      </Button>

      {open && (
        <div className="surface-pop absolute left-0 top-full z-50 mt-1 flex w-64 flex-col gap-3 rounded-lg p-3">
          <div className="grid grid-cols-2 gap-1.5">
            {quicks.map((q) => (
              <Button
                key={q.iso}
                variant="secondary"
                size="sm"
                className={cn(selectedIso === q.iso && "bg-accent/15 text-accent")}
                onClick={() => pickDay(q.iso)}
              >
                {q.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" disabled={!dueAt} onClick={clear}>
              {t("home.todosDueNone")}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("home.todosDuePrevMonth")}
              onClick={() =>
                setView((v) => (v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 }))
              }
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm font-medium">{monthLabel}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("home.todosDueNextMonth")}
              onClick={() =>
                setView((v) => (v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 }))
              }
            >
              <ChevronRight />
            </Button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {weekdays.map((d) => (
              <span key={d} className="text-2xs font-medium text-muted-foreground">
                {d}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: leading blanks are positional by nature
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1;
              const iso = `${view.y}-${p2(view.m + 1)}-${p2(day)}`;
              const isSelected = iso === selectedIso;
              const isToday = iso === dayIso(todayStart);
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pickDay(iso)}
                  className={cn(
                    "h-7 w-7 rounded-md text-sm tabular-nums transition-colors hover:bg-secondary",
                    isSelected
                      ? "bg-accent text-accent-foreground hover:bg-accent"
                      : isToday && "font-semibold text-accent",
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <Input
              type="time"
              value={time}
              onChange={(e) => pickTime(e.target.value)}
              aria-label={t("home.todosDueTime")}
              className="h-7 w-auto px-2 py-0 text-sm tabular-nums"
            />
            {time && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("home.todosDueClearTime")}
                onClick={() => onChange(selectedIso)}
              >
                <X />
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
