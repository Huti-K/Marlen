import { describe, expect, it } from "vitest";
import { stripDuplicateSignoff } from "../../src/email/textUtils.js";

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
