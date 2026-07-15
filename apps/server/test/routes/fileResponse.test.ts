import { describe, expect, it } from "vitest";
import { contentDisposition, inlineForMime, mimeForExt } from "../../src/routes/fileResponse.js";

describe("mimeForExt", () => {
  it("maps known document and image extensions, with or without a leading dot", () => {
    expect(mimeForExt("pdf")).toBe("application/pdf");
    expect(mimeForExt(".pdf")).toBe("application/pdf");
    expect(mimeForExt("PNG")).toBe("image/png");
    expect(mimeForExt("jpeg")).toBe("image/jpeg");
    expect(mimeForExt("csv")).toBe("text/plain; charset=utf-8");
  });

  it("serves html as inert text/plain, never text/html", () => {
    expect(mimeForExt("html")).toBe("text/plain; charset=utf-8");
    expect(mimeForExt("htm")).toBe("text/plain; charset=utf-8");
  });

  it("falls back to octet-stream for unknown types", () => {
    expect(mimeForExt("exe")).toBe("application/octet-stream");
    expect(mimeForExt("")).toBe("application/octet-stream");
  });
});

describe("inlineForMime", () => {
  it("allows PDF, plain text and raster images inline", () => {
    expect(inlineForMime("application/pdf")).toBe(true);
    expect(inlineForMime("text/plain; charset=utf-8")).toBe(true);
    expect(inlineForMime("image/png")).toBe(true);
    expect(inlineForMime("image/webp")).toBe(true);
  });

  it("keeps SVG and unknown types out of inline (they download)", () => {
    expect(inlineForMime("image/svg+xml")).toBe(false);
    expect(inlineForMime("application/octet-stream")).toBe(false);
    expect(
      inlineForMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe(false);
  });
});

describe("contentDisposition", () => {
  it("ships an ASCII fallback plus the exact UTF-8 name", () => {
    expect(contentDisposition("inline", "invoice.pdf")).toBe(
      `inline; filename="invoice.pdf"; filename*=UTF-8''invoice.pdf`,
    );
  });

  it("sanitizes quotes and non-Latin1 characters in the ASCII fallback", () => {
    const value = contentDisposition("attachment", 'Rêsümé "final".pdf');
    expect(value.startsWith('attachment; filename="R_s_m_ final.pdf"')).toBe(true);
    expect(value).toContain("filename*=UTF-8''");
    expect(value).toContain(encodeURIComponent('Rêsümé "final".pdf'));
  });
});
