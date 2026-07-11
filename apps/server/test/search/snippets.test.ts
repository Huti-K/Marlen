import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  collapseWhitespace,
  plainText,
  trimSnippet,
} from "../../src/search/snippets.js";

describe("collapseWhitespace", () => {
  it("collapses runs of whitespace to a single space and trims the ends", () => {
    expect(collapseWhitespace("  hello   world\n\nfoo\t bar  ")).toBe("hello world foo bar");
  });
});

describe("plainText", () => {
  it("strips markdown formatting before collapsing whitespace", () => {
    expect(plainText("## Heading\n\n**bold** and _not italic_ and `code`")).toBe(
      "Heading bold and _not italic_ and code",
    );
  });

  it("strips code fences, links and images entirely or down to their label", () => {
    expect(plainText("before ```js\nconst x = 1;\n``` after")).toBe("before after");
    expect(plainText("see [the docs](https://example.com) for more")).toBe("see the docs for more");
    expect(plainText("![alt text](https://example.com/pic.png) caption")).toBe("caption");
  });

  it("strips blockquotes and list markers at the start of a line", () => {
    expect(plainText("> quoted line\n- item one\n1. item two")).toBe(
      "quoted line item one item two",
    );
  });

  it("keeps a bare asterisk used as multiplication rather than emphasis", () => {
    expect(plainText("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});

describe("buildSnippet", () => {
  it("centers ~320 chars of plain text around the first case-insensitive match", () => {
    const text = `${"x".repeat(200)} ZEPHYR ${"y".repeat(200)}`;
    const snippet = buildSnippet(text, "zephyr");
    expect(snippet).toContain("ZEPHYR");
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("falls back to the start of the text when there is no match", () => {
    expect(buildSnippet("short text with no hit", "nonexistent")).toBe("short text with no hit");
  });

  it("returns an empty string for text that collapses to nothing", () => {
    expect(buildSnippet("   \n\t  ", "query")).toBe("");
  });
});

describe("trimSnippet", () => {
  it("passes short text through unchanged (whitespace collapsed)", () => {
    expect(trimSnippet("  hello   world  ")).toBe("hello world");
  });

  it("caps length at `max` and appends an ellipsis, breaking on a word boundary", () => {
    const value = "one two three four five six seven eight nine ten";
    const trimmed = trimSnippet(value, 20);
    expect(trimmed.length).toBeLessThanOrEqual(20);
    expect(trimmed.endsWith("…")).toBe(true);
  });
});
