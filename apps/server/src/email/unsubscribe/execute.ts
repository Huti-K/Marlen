import { errorMessage } from "../../util.js";

/**
 * RFC 8058 one-click unsubscribe: POST to the sender-supplied https URL with
 * a fixed body, no cookies, and no auth headers — the mechanism exists
 * precisely so a mail client can fire this without ever authenticating as
 * the recipient. `redirect: "manual"` means a 3xx comes back as a normal
 * response instead of being followed, so a Location header (to anywhere,
 * https or not) is never itself fetched; RFC 8058 doesn't define what a
 * redirect here means, so it's treated as accepted, same as a plain 2xx.
 * GET is never used — the whole point of List-Unsubscribe-Post existing is
 * that a bare GET must not be able to unsubscribe anyone (crawlers, link
 * scanners, proxies all issue GETs).
 */

export interface UnsubscribeExecuteResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;
const ONE_CLICK_BODY = "List-Unsubscribe=One-Click";

/**
 * True for a host that must never be the target of a one-click POST: the URL
 * comes verbatim from a sender-controlled `List-Unsubscribe` header, so a
 * crafted value pointing at loopback, a private LAN range, or link-local would
 * turn this request into an SSRF probe of the user's own machine and network.
 * Covers IP literals (v4, v6, and v4-mapped v6) plus the `localhost` name; a
 * hostname that resolves to a private address via DNS is not caught here
 * (that would need a lookup before every request) and is left for a future
 * hardening pass.
 */
export function isBlockedUnsubscribeHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 0 || // "this host"
      a === 127 || // loopback
      a === 10 || // private
      (a === 172 && b >= 16 && b <= 31) || // private
      (a === 192 && b === 168) || // private
      (a === 169 && b === 254) // link-local
    );
  }

  // IPv4-mapped IPv6, dotted form (e.g. ::ffff:127.0.0.1).
  const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped?.[1]) return isBlockedUnsubscribeHost(mapped[1]);
  // Same, but the hex form the WHATWG URL parser canonicalizes to
  // (::ffff:127.0.0.1 → ::ffff:7f00:1): rebuild the v4 octets from the two
  // 16-bit groups and re-check.
  const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex?.[1] && mappedHex[2]) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    return isBlockedUnsubscribeHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }

  // IPv6 literals: loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7).
  return (
    host === "::1" || host === "::" || host.startsWith("fe80:") || /^f[cd][0-9a-f]*:/.test(host)
  );
}

/**
 * `fetchImpl` exists only for tests (a real https certificate isn't
 * practical to stand up for a unit test) — every real caller uses the
 * default, the global fetch.
 */
export async function executeOneClickUnsubscribe(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UnsubscribeExecuteResult> {
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: "one-click unsubscribe requires an https URL" };
  }

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: "unsubscribe URL is malformed" };
  }
  if (isBlockedUnsubscribeHost(hostname)) {
    return { ok: false, error: "unsubscribe URL points at a private or local address" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: ONE_CLICK_BODY,
      redirect: "manual",
      credentials: "omit",
      signal: controller.signal,
    });
    if (res.status >= 400) {
      return { ok: false, status: res.status, error: `sender responded ${res.status}` };
    }
    return { ok: true, status: res.status };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: timedOut ? "unsubscribe request timed out" : errorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}
