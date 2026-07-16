import type { useTranslation } from "react-i18next";

/**
 * Plain-language schedule presets over cron. The server keeps storing cron
 * (node-cron is the authority); these helpers only translate between the
 * picker and the cron strings it can express. Anything the picker can't
 * express stays raw cron behind the "Advanced" toggle.
 */

type ScheduleFrequency = "daily" | "weekdays" | "custom" | "date";

export interface SchedulePreset {
  frequency: ScheduleFrequency;
  /** "HH:MM", 24h. */
  time: string;
  /** 0-6, 0 = Sunday. One or more days; only meaningful when frequency is "custom". */
  weekdays: number[];
  /** 1-12; only meaningful when frequency is "date". */
  month: number;
  /** 1-31; only meaningful when frequency is "date". */
  day: number;
}

export const DEFAULT_PRESET: SchedulePreset = {
  frequency: "daily",
  time: "08:00",
  weekdays: [1],
  month: 1,
  day: 1,
};

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Non-leap day count; keeps Feb 29 out of the picker rather than silently never firing. */
export function daysInMonth(month: number): number {
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

export function buildCron({ frequency, time, weekdays, month, day }: SchedulePreset): string {
  const [h = 8, m = 0] = time.split(":").map((part) => Number.parseInt(part, 10));
  const hour = Number.isFinite(h) ? h : 8;
  const minute = Number.isFinite(m) ? m : 0;
  switch (frequency) {
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "custom": {
      const days = [...new Set(weekdays)].sort((a, b) => a - b);
      return `${minute} ${hour} * * ${days.length > 0 ? days.join(",") : "1"}`;
    }
    case "date":
      return `${minute} ${hour} ${day} ${month} *`;
  }
}

/** Reverse of buildCron, for exactly the shapes it emits; anything else → null. */
export function parseCron(expr: string): SchedulePreset | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m = "", h = "", dom = "", month = "", dow = ""] = parts;
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(h)) return null;
  const minute = Number(m);
  const hour = Number(h);
  if (minute > 59 || hour > 23) return null;
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  if (dom === "*" && month === "*") {
    if (dow === "*") return { ...DEFAULT_PRESET, frequency: "daily", time };
    if (dow === "1-5") return { ...DEFAULT_PRESET, frequency: "weekdays", time };
    const dowParts = dow.split(",");
    const days = dowParts.map((d) => (/^[0-7]$/.test(d) ? Number(d) % 7 : NaN)); // cron's 7 = Sunday
    if (days.length > 0 && days.every((d) => !Number.isNaN(d))) {
      return { ...DEFAULT_PRESET, frequency: "custom", time, weekdays: days };
    }
    return null;
  }

  if (dow === "*" && /^\d{1,2}$/.test(dom) && /^\d{1,2}$/.test(month)) {
    const day = Number(dom);
    const mo = Number(month);
    if (day >= 1 && day <= daysInMonth(mo) && mo >= 1 && mo <= 12) {
      return { ...DEFAULT_PRESET, frequency: "date", time, month: mo, day };
    }
  }
  return null;
}

/** Localized weekday name (0 = Sunday). */
export function weekdayName(weekday: number, locale: string): string {
  // 2023-01-01 was a Sunday.
  const date = new Date(Date.UTC(2023, 0, 1 + weekday));
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(date);
}

/** Short localized weekday label (0 = Sunday), e.g. "Mon". */
export function weekdayShortName(weekday: number, locale: string): string {
  const date = new Date(Date.UTC(2023, 0, 1 + weekday));
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(date);
}

/** Localized month name, 1-12. */
export function monthName(month: number, locale: string): string {
  const date = new Date(Date.UTC(2023, month - 1, 1));
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(date);
}

/** Localized "Mar 5"-style label for a month/day pair. */
export function monthDayLabel(month: number, day: number, locale: string): string {
  const date = new Date(Date.UTC(2023, month - 1, day));
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** "Weekdays · 08:00"-style label; null when the cron isn't picker-shaped. */
export function scheduleLabel(
  schedule: string,
  t: ReturnType<typeof useTranslation>["t"],
  locale: string,
): string | null {
  const preset = parseCron(schedule);
  if (!preset) return null;
  switch (preset.frequency) {
    case "daily":
      return t("automations.scheduleLabel.daily", { time: preset.time });
    case "weekdays":
      return t("automations.scheduleLabel.weekdays", { time: preset.time });
    case "custom":
      return t("automations.scheduleLabel.custom", {
        days: preset.weekdays.map((d) => weekdayShortName(d, locale)).join(", "),
        time: preset.time,
      });
    case "date":
      return t("automations.scheduleLabel.date", {
        date: monthDayLabel(preset.month, preset.day, locale),
        time: preset.time,
      });
  }
}
