import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LATEST_URL, OnOfficeClient, STABLE_URL } from "../../src/onoffice/client.js";

/**
 * The client HMAC-signs each action (hmac_version 2) and POSTs to one endpoint.
 * Fake fetch at the global boundary and recompute the signature rather than
 * hardcoding it, so the test pins the signing formula, not a magic string.
 */

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockFetch(payload: unknown, status = 200): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

const okEnvelope = { status: { code: 200 }, response: { results: [{ status: { errorcode: 0 } }] } };

describe("OnOfficeClient", () => {
  it("rejects construction without both credentials", () => {
    expect(() => new OnOfficeClient({ token: "", secret: "s" })).toThrow(/credentials missing/);
    expect(() => new OnOfficeClient({ token: "t", secret: "" })).toThrow(/credentials missing/);
  });

  it("signs each action with hmac v2 and posts to the stable endpoint", async () => {
    const fetchSpy = mockFetch(okEnvelope);
    const client = new OnOfficeClient({ token: "tok", secret: "sec" });

    await client.action("read", "estate", { parameters: { data: ["Id"] } });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(STABLE_URL);
    const body = JSON.parse(init.body as string);
    expect(body.token).toBe("tok");

    const action = body.request.actions[0];
    expect(action.actionid).toBe("urn:onoffice-de-ns:smart:2.5:smartml:action:read");
    expect(action.resourcetype).toBe("estate");
    expect(action.hmac_version).toBe("2");

    const message = `${action.timestamp}tok${action.resourcetype}${action.actionid}`;
    const expected = createHmac("sha256", "sec").update(message).digest("base64");
    expect(action.hmac).toBe(expected);
  });

  it("honors an apiUrl override (the 'latest' endpoint)", async () => {
    const fetchSpy = mockFetch(okEnvelope);
    const client = new OnOfficeClient({ token: "t", secret: "s", apiUrl: LATEST_URL });
    expect(client.apiUrl).toBe(LATEST_URL);
    await client.action("get", "fields", { parameters: { modules: ["estate"] } });
    expect(fetchSpy.mock.calls[0][0]).toBe(LATEST_URL);
  });

  it("throws on a transport-level error status", async () => {
    mockFetch({ status: { code: 400, errorcode: 12, message: "bad request" } });
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await expect(client.action("read", "estate")).rejects.toThrow(
      /onOffice API error.*bad request/,
    );
  });

  it("throws on a per-action errorcode", async () => {
    mockFetch({ response: { results: [{ status: { errorcode: 3, message: "no such field" } }] } });
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await expect(client.action("read", "estate")).rejects.toThrow(
      /onOffice action error.*no such field/,
    );
  });

  it("throws a readable error on a non-JSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>missing", { status: 404 }));
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await expect(client.action("read", "estate")).rejects.toThrow(/non-JSON response \(HTTP 404\)/);
  });

  it("throws on a top-level errorcode even when the status code is 200", async () => {
    mockFetch({ status: { code: 200, errorcode: 137, message: "hmac invalid" } });
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await expect(client.action("read", "estate")).rejects.toThrow(/137.*hmac invalid/);
  });

  it("fails on an HTTP error even when the body claims success", async () => {
    const fetchSpy = mockFetch(okEnvelope, 401);
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await expect(client.action("read", "estate")).rejects.toThrow(/HTTP 401/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries a read-only batch on a transient network failure", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(okEnvelope), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new OnOfficeClient({ token: "t", secret: "s" });

    const pending = client.action("read", "estate");
    const outcome = expect(pending).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(500);
    await outcome;
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("stops after three attempts when transient failures persist", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("<html>gateway", { status: 502 }));
    const client = new OnOfficeClient({ token: "t", secret: "s" });

    const pending = client.action("read", "estate");
    const outcome = expect(pending).rejects.toThrow(/non-JSON response \(HTTP 502\)/);
    await vi.advanceTimersByTimeAsync(1500);
    await outcome;
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("gives mutating actions exactly one attempt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new TypeError("socket hang up"));
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await expect(client.action("create", "address")).rejects.toThrow(
      /request failed: socket hang up/,
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("aborts a hung request at the per-attempt deadline", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const client = new OnOfficeClient({ token: "t", secret: "s", requestTimeoutMs: 20 });
    await expect(client.action("create", "address")).rejects.toThrow(/timed out after 20ms/);
  });

  it("batches multiple actions into one signed request", async () => {
    const fetchSpy = mockFetch(okEnvelope);
    const client = new OnOfficeClient({ token: "t", secret: "s" });
    await client.call([
      { actionid: "read", resourcetype: "estate" },
      { actionid: "get", resourcetype: "fields" },
    ]);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.request.actions).toHaveLength(2);
  });
});
