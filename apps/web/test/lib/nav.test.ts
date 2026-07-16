import { describe, expect, it } from "vitest";
import { NAV_ITEMS, visibleNavItems } from "@/lib/nav";

describe("visibleNavItems", () => {
  it("hides the onOffice-bound views while the CRM is unconfigured", () => {
    const visible = visibleNavItems(false);
    expect(visible.map((item) => item.id)).not.toContain("leads");
    expect(visible.length).toBeLessThan(NAV_ITEMS.length);
  });

  it("shows the full nav once onOffice is connected", () => {
    expect(visibleNavItems(true)).toEqual(NAV_ITEMS);
  });
});
