import { describe, expect, it } from "vitest";
import {
  detachSignature,
  htmlBodyWithSignature,
  stripDuplicateSignoff,
  stripHtml,
} from "../../src/email/textUtils.js";

/**
 * The dedup guard is what keeps a signed account from ever sending a double
 * signature: whatever sign-off the model writes, the body must end cleanly
 * above the appended signature. A false positive here silently truncates real
 * prose, so the conservative cases matter as much as the stripping ones.
 */

const SIGNATURE_TEXT =
  "Mit freundlichen Grüßen\nMax Mustermann\nMusterfirma GmbH\nTel: +49 30 123456";

describe("stripDuplicateSignoff", () => {
  it("drops a model-written closing and name the signature already carries", () => {
    const body = "Hallo Frau Beispiel,\n\ngerne bis Donnerstag.\n\nViele Grüße,\nMax Mustermann";
    expect(stripDuplicateSignoff(body, SIGNATURE_TEXT)).toBe(
      "Hallo Frau Beispiel,\n\ngerne bis Donnerstag.",
    );
  });

  it("keeps a closing phrase when the signature has no closing of its own", () => {
    const body = "Anbei das Exposé.\n\nViele Grüße,\nMax Mustermann";
    const signatureWithoutClosing = "Max Mustermann\nMusterfirma GmbH";
    expect(stripDuplicateSignoff(body, signatureWithoutClosing)).toBe(
      "Anbei das Exposé.\n\nViele Grüße,",
    );
  });

  it("leaves prose that merely resembles a closing untouched", () => {
    const body = "Wir senden Ihnen viele Grüße aus Berlin mit.\n\nDie Unterlagen folgen morgen.";
    expect(stripDuplicateSignoff(body, SIGNATURE_TEXT)).toBe(body);
  });

  it("never empties a body that is nothing but sign-off", () => {
    const body = "Viele Grüße,\nMax Mustermann";
    expect(stripDuplicateSignoff(body, SIGNATURE_TEXT)).toBe(body);
  });
});

/**
 * The outgoing HTML composition is what recipients actually see: an unstyled
 * body next to a styled signature reads as two different emails, and data-URI
 * images are blocked by receiving clients, so both invariants get pinned.
 */
describe("htmlBodyWithSignature", () => {
  it("wraps body and signature in one font-styled container, escaping the body", () => {
    const { html, images } = htmlBodyWithSignature("Termin <morgen>?\nViele Grüße", "<p>Max</p>");
    expect(images).toEqual([]);
    expect(html).toMatch(/^<div style="font-family:[^"]+">/);
    expect(html).toContain("Termin &lt;morgen&gt;?<br>Viele Grüße<br><br><p>Max</p>");
    expect(html.endsWith("</div>")).toBe(true);
  });

  it("extracts data-URI images to cid references, deduplicating identical bytes", () => {
    const pixel = "iVBORw0KGgoAAAANSUhEUg==";
    const signature =
      `<p>Max<img src="data:image/png;base64,${pixel}">` +
      `<img src="data:image/png;base64,${pixel}"></p>` +
      `<img src="https://example.com/logo.png">`;
    const { html, images } = htmlBodyWithSignature("Hallo", signature);
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/png");
    expect(images[0]?.content).toEqual(Buffer.from(pixel, "base64"));
    expect(html).not.toContain("data:image/png");
    expect(html).toContain(`src="cid:${images[0]?.contentId}"`);
    expect(html).toContain('src="https://example.com/logo.png"');
  });
});

/**
 * detachSignature is what lets the UI edit prose without touching the
 * signature: a false negative merely shows the signature inside the body, but
 * a false positive re-appends the signature over a body that never carried it,
 * so the no-match cases are load-bearing.
 */
describe("detachSignature", () => {
  const SIGNATURE_HTML = "<p>Mit freundlichen Grüßen<br>Max Mustermann<br>Musterfirma GmbH</p>";
  const signatureText = () => stripHtml(SIGNATURE_HTML);

  it("splits a provider round-tripped body into prose and signature", () => {
    // The exact pipeline a signed draft goes through: composed into one HTML
    // wrapper, then read back as text like the provider detail does.
    const { html } = htmlBodyWithSignature("Hallo Frau Beispiel,\n\ngerne morgen.", SIGNATURE_HTML);
    const roundTripped = stripHtml(html);
    const detached = detachSignature(roundTripped, signatureText());
    expect(detached?.body).toBe("Hallo Frau Beispiel,\n\ngerne morgen.");
    expect(detached?.signature).toBe(signatureText());
  });

  it("survives spacing differences from the HTML round-trip", () => {
    const body = `Kurzer Text.\n\n\nMit  freundlichen Grüßen\n\nMax Mustermann\nMusterfirma GmbH  `;
    expect(detachSignature(body, signatureText())?.body).toBe("Kurzer Text.");
  });

  it("returns null for a body that does not end with the signature", () => {
    expect(detachSignature("Hallo,\n\nbis morgen.\n\nViele Grüße,\nMax", signatureText())).toBe(
      null,
    );
  });

  it("returns null when the signature only appears mid-body", () => {
    const body = `${signatureText()}\n\nPS: Anbei noch die Unterlagen.`;
    expect(detachSignature(body, signatureText())).toBe(null);
  });

  it("detaches a draft that is nothing but the signature to an empty body", () => {
    expect(detachSignature(signatureText(), signatureText())?.body).toBe("");
  });
});
