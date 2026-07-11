import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../../src/email/registry.js";

describe("createProviderRegistry", () => {
  it("returns null for an app with no registered provider", () => {
    const registry = createProviderRegistry<{ id: string }>();
    expect(registry.get("gmail")).toBeNull();
  });

  it("returns the provider registered for that app", () => {
    const registry = createProviderRegistry<{ id: string }>();
    const provider = { id: "gmail-provider" };
    registry.register("gmail", provider);
    expect(registry.get("gmail")).toBe(provider);
  });

  it("keeps separate registries independent", () => {
    const drafts = createProviderRegistry<string>();
    const attachments = createProviderRegistry<string>();
    drafts.register("gmail", "draft-impl");
    expect(attachments.get("gmail")).toBeNull();
  });
});
