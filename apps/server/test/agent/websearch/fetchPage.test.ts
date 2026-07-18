import { describe, expect, it } from "vitest";
import {
  extractPageText,
  fetchPage,
  isPrivateAddress,
} from "../../../src/agent/websearch/fetchPage.js";

describe("isPrivateAddress", () => {
  it("blocks private, loopback, link-local, CGNAT and reserved v4 ranges", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.1.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.5",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public v4 addresses", () => {
    for (const ip of ["8.8.8.8", "100.128.0.1", "172.32.0.1", "203.0.113.9"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("blocks loopback, unspecified, unique-local, link-local and mapped-private v6", () => {
    for (const ip of [
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:192.168.1.5",
      "::ffff:7f00:1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("allows public v6 and ignores non-IP strings", () => {
    for (const value of ["2607:f8b0::1", "::ffff:8.8.8.8", "example.com", ""]) {
      expect(isPrivateAddress(value), value).toBe(false);
    }
  });
});

describe("fetchPage guards", () => {
  it.each([
    ["not a url", "not a valid absolute URL"],
    ["ftp://example.com/file", "Only http(s)"],
    ["http://user:pw@example.com/", "embedded credentials"],
    ["http://localhost/admin", "private or internal"],
    ["http://127.0.0.1:8080/", "private or internal"],
    ["http://[::1]/", "private or internal"],
    ["http://10.1.2.3/", "private or internal"],
  ])("refuses %s", async (url, message) => {
    await expect(fetchPage({ url })).rejects.toThrow(message);
  });
});

describe("extractPageText", () => {
  it("renders HTML to text, keeping link targets and dropping script/style/images", () => {
    const html = `<html><head><style>p{color:red}</style><script>alert(1)</script></head>
      <body><h1>Über uns</h1><p>Hallo <a href="https://example.com/x">weiter</a></p>
      <img src="pic.png" alt="pic"></body></html>`;
    const text = extractPageText(html, "text/html; charset=utf-8");
    expect(text).toContain("Über uns");
    expect(text).toContain("weiter [https://example.com/x]");
    expect(text).not.toContain("alert(1)");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("pic.png");
  });

  it("passes textual and JSON bodies through unchanged", () => {
    expect(extractPageText("  plain body \n", "text/plain")).toBe("plain body");
    expect(extractPageText('{"a":1}', "application/ld+json")).toBe('{"a":1}');
  });

  it("sniffs markup when the content type is missing", () => {
    expect(extractPageText("<p>hi</p>", "")).toBe("hi");
    expect(extractPageText("just text", "")).toBe("just text");
  });

  it("refuses binary content types", () => {
    expect(() => extractPageText("%PDF-1.7", "application/pdf")).toThrow("binary");
  });
});
