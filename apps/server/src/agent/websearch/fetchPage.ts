import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type HtmlToTextOptions, htmlToText } from "html-to-text";

/**
 * Direct URL fetch behind the agent's web_fetch tool: validates the target,
 * refuses private and internal addresses, follows redirects hop-by-hop under
 * the same check, and renders the body as plain text. The address guard
 * exists because sessions read attacker-controllable mail: a mail body must
 * never be able to steer a fetch at localhost (the app's own API) or the
 * LAN. The guard checks the addresses resolved here, not the ones the socket
 * ultimately connects to — its job is that naming a private target doesn't
 * work, not resisting a hostile DNS setup.
 */

const MAX_REDIRECTS = 5;
/** Download cap; a body cut here is reported to the model as incomplete. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = "Mozilla/5.0 (compatible; Trailin/1.0)";

/**
 * Page links stay navigable — html-to-text's default "text [url]" rendering
 * is what lets the model fetch a page it discovered on another page. Only
 * images are noise. (Email stripping in email/textUtils.ts makes the
 * opposite call: bodies are for reading, so hrefs go.)
 */
const PAGE_TEXT_OPTIONS: HtmlToTextOptions = {
  wordwrap: false,
  selectors: [
    { selector: "img", format: "skip" },
    ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({
      selector,
      options: { uppercase: false },
    })),
  ],
};

/**
 * True for addresses the tool must never reach: loopback, RFC1918, CGNAT,
 * link-local, unique-local, unspecified, multicast/reserved, and
 * v4-mapped v6 forms of any of those.
 */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return a >= 224;
  }
  if (family === 6) {
    const ip = address.toLowerCase();
    if (ip === "::" || ip === "::1") return true;
    if (/^f[cd]/.test(ip)) return true;
    if (/^fe[89ab]/.test(ip)) return true;
    const mapped = /^::ffff:(.+)$/.exec(ip)?.[1];
    if (mapped) {
      if (mapped.includes(".")) return isPrivateAddress(mapped);
      const groups = mapped.split(":");
      const [hi, lo] = groups.map((group) => Number.parseInt(group, 16));
      if (groups.length === 2 && hi !== undefined && lo !== undefined) {
        return isPrivateAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
      }
    }
  }
  return false;
}

/** Protocol/credential gate shared by the initial URL and every redirect hop. */
function checkedUrl(url: URL): URL {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be fetched, not ${url.protocol.replace(/:$/, "")}.`);
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not fetched.");
  }
  return url;
}

function parseFetchableUrl(raw: string): URL {
  try {
    return checkedUrl(new URL(raw));
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`"${raw}" is not a valid absolute URL.`);
    throw error;
  }
}

/** Resolves the host and throws if any of its addresses is private/internal. */
async function assertPublicHost(url: URL): Promise<void> {
  const bare = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(bare)
    ? [bare]
    : (await lookup(bare, { all: true })).map((entry) => entry.address);
  if (addresses.some(isPrivateAddress)) {
    throw new Error(
      `${url.hostname} is a private or internal address — web_fetch only reaches the public web.`,
    );
  }
}

/**
 * Renders a response body as plain text by content type: HTML/XML through
 * html-to-text, textual types as-is; anything binary is refused with the
 * reason. An absent content type is sniffed by whether the body reads as
 * markup.
 */
export function extractPageText(body: string, contentType: string): string {
  const type = (contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (type.includes("html") || type.includes("xml") || (type === "" && /^\s*</.test(body))) {
    return htmlToText(body, PAGE_TEXT_OPTIONS).trim();
  }
  if (type === "" || type.startsWith("text/") || type.endsWith("json")) return body.trim();
  throw new Error(`The URL returned ${type} — web_fetch reads pages and text, not binary files.`);
}

async function readBodyCapped(response: Response): Promise<{ bytes: Uint8Array; capped: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(0), capped: false };
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Breaking out of for-await cancels the stream via the iterator's return().
  for await (const chunk of response.body) {
    chunks.push(chunk);
    total += chunk.length;
    if (total >= MAX_BODY_BYTES) break;
  }
  return { bytes: Buffer.concat(chunks), capped: total >= MAX_BODY_BYTES };
}

function decodeBody(bytes: Uint8Array, contentType: string): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

export interface FetchedPage {
  /** Final URL, after any redirects. */
  url: string;
  /** The whole page as plain text (slicing for the model is the tool's job). */
  text: string;
  /** True when the download hit MAX_BODY_BYTES, so the page end is missing. */
  bodyCapped: boolean;
}

export async function fetchPage(opts: { url: string; signal?: AbortSignal }): Promise<FetchedPage> {
  let url = parseFetchableUrl(opts.url);
  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;

  for (let hop = 0; ; hop++) {
    await assertPublicHost(url);
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location)
        throw new Error(`The server redirected (${response.status}) without a target.`);
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
      try {
        url = checkedUrl(new URL(location, url));
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error(`The server redirected to an invalid location "${location}".`);
        }
        throw error;
      }
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      const label = `${response.status} ${response.statusText}`.trim();
      throw new Error(`The server answered ${label} for ${url}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const { bytes, capped } = await readBodyCapped(response);
    return {
      url: url.toString(),
      text: extractPageText(decodeBody(bytes, contentType), contentType),
      bodyCapped: capped,
    };
  }
}
