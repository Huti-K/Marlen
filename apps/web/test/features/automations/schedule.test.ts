import type { useTranslation } from "react-i18next";
import { describe, expect, it } from "vitest";
import {
  buildCron,
  DEFAULT_PRESET,
  parseCron,
  scheduleLabel,
} from "@/features/automations/schedule";

/** Key-echoing stub — these tests assert which label key a schedule resolves to. */
const t = ((key: string) => key) as ReturnType<typeof useTranslation>["t"];

describe("manual-only schedules", () => {
  it("buildCron emits the empty schedule for the manual frequency", () => {
    expect(buildCron({ ...DEFAULT_PRESET, frequency: "manual" })).toBe("");
  });

  it("parseCron maps an empty schedule to the manual preset", () => {
    expect(parseCron("")?.frequency).toBe("manual");
    expect(parseCron("   ")?.frequency).toBe("manual");
  });

  it("round-trips through buildCron", () => {
    const cron = buildCron({ ...DEFAULT_PRESET, frequency: "manual" });
    expect(parseCron(cron)?.frequency).toBe("manual");
  });

  it("labels a manual-only schedule without a time", () => {
    expect(scheduleLabel("", t, "en")).toBe("automations.scheduleLabel.manual");
  });
});

describe("cron schedules stay picker-shaped", () => {
  it("still parses the shapes buildCron emits", () => {
    expect(parseCron("30 8 * * *")).toMatchObject({ frequency: "daily", time: "08:30" });
    expect(parseCron("0 9 * * 1-5")?.frequency).toBe("weekdays");
    expect(parseCron("0 9 15 3 *")).toMatchObject({ frequency: "date", month: 3, day: 15 });
  });

  it("rejects cron the picker can't express", () => {
    expect(parseCron("*/5 * * * *")).toBeNull();
  });
});
