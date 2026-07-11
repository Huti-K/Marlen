import { describe, expect, it } from "vitest";
import { snippetFrom, splitAddressList, stripHtml } from "../../src/email/textUtils.js";

describe("stripHtml", () => {
  it("converts <br> and <br/> into newlines", () => {
    expect(stripHtml("a<br>b<br/>c")).toBe("a\nb\nc");
  });

  it("converts <br /> with a space before the slash into a newline", () => {
    expect(stripHtml("a<br />b")).toBe("a\nb");
  });

  it("converts </p> into a blank line (double newline)", () => {
    expect(stripHtml("<p>a</p><p>b</p>")).toBe("a\n\nb");
  });

  it("strips all other tags", () => {
    expect(stripHtml("<div><span>hi</span> <b>there</b></div>")).toBe("hi there");
  });

  it("trims the result", () => {
    expect(stripHtml("<p>  hi  </p>")).toBe("hi");
  });

  it("passes plain text through unchanged", () => {
    expect(stripHtml("just plain text")).toBe("just plain text");
  });

  it("drops style and script contents, not just their tags", () => {
    expect(stripHtml("<style>.a{color:red}</style><script>x()</script><p>hi</p>")).toBe("hi");
  });

  it("decodes HTML entities", () => {
    expect(stripHtml("Tom &amp; Jerry&#39;s")).toBe("Tom & Jerry's");
  });

  it("keeps link text but drops the href", () => {
    expect(stripHtml('<a href="https://example.com">click me</a>')).toBe("click me");
  });
});

describe("snippetFrom", () => {
  it("collapses whitespace runs (including newlines and tabs) to single spaces and trims", () => {
    expect(snippetFrom("  hello\n\tworld   foo  ")).toBe("hello world foo");
  });

  it("returns text as-is when at the default 140 cap", () => {
    const text = "a".repeat(140);
    expect(snippetFrom(text)).toBe(text);
  });

  it("returns text as-is when below the default 140 cap", () => {
    const text = "a".repeat(50);
    expect(snippetFrom(text)).toBe(text);
  });

  it("truncates above the default cap, trims trailing space, and appends an ellipsis", () => {
    const text = `${"a".repeat(139)} ${"b".repeat(20)}`;
    const result = snippetFrom(text);
    expect(result).toBe(`${"a".repeat(139)}…`);
  });

  it("honors a custom max length", () => {
    const text = "x".repeat(250);
    expect(snippetFrom(text, 200)).toBe(`${"x".repeat(200)}…`);
  });

  it("returns an empty string for an empty string", () => {
    expect(snippetFrom("")).toBe("");
  });
});

describe("splitAddressList", () => {
  it("splits a simple list, trims entries, and drops empties", () => {
    expect(splitAddressList("a@x.com, B <b@y.com>,, ")).toEqual(["a@x.com", "B <b@y.com>"]);
  });

  it("returns an empty array for an empty string", () => {
    expect(splitAddressList("")).toEqual([]);
  });

  it("keeps a comma inside a quoted display name as one entry", () => {
    expect(splitAddressList('"Kaya, Ayşe" <ayse@x.com>, bob@y.com')).toEqual([
      "Kaya, Ayşe <ayse@x.com>",
      "bob@y.com",
    ]);
  });

  it("flattens an address group to its members", () => {
    expect(splitAddressList("team: a@x.com, B <b@y.com>;")).toEqual(["a@x.com", "B <b@y.com>"]);
  });

  it("falls back to a comma split when the value is not a parseable address list", () => {
    expect(splitAddressList("Ayşe Kaya, not-an-address")).toEqual(["Ayşe Kaya", "not-an-address"]);
  });
});
