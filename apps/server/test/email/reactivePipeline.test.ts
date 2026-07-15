import { afterEach, describe, expect, it, vi } from "vitest";
import { createMailReactivePipeline } from "../../src/email/reactivePipeline.js";
import { emitServerEvent } from "../../src/events.js";

// events.ts's bus is a real in-process EventEmitter with no DB dependency, so
// pipelines under test subscribe to and are driven by the real thing rather
// than a fake.

describe("createMailReactivePipeline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a boot catch-up cycle once start() clears the debounce window", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 100,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    expect(runs).toBe(0); // debounced, not synchronous
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);
    pipeline.stop();
  });

  it("a 'mail' server event triggers a debounced cycle", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 100,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);

    emitServerEvent("mail");
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(2);
    pipeline.stop();
  });

  it("ignores server events on other topics", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 100,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);

    emitServerEvent("contacts");
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1); // unchanged — no cycle for a non-"mail" topic
    pipeline.stop();
  });

  it("coalesces several 'mail' events landing inside the debounce window into one cycle", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 100,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);

    emitServerEvent("mail");
    emitServerEvent("mail");
    emitServerEvent("mail");
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(2);
    pipeline.stop();
  });

  it("the safety interval keeps draining on its own cadence with no events at all", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 0,
      safetyIntervalMs: 1_000,
    });
    pipeline.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(runs).toBe(2);
    pipeline.stop();
  });

  it("trigger() asks for a cycle the same way a 'mail' event would", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 50,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(1);

    pipeline.trigger();
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(2);
    pipeline.stop();
  });

  it("stop() unsubscribes and cancels a pending cycle; a later 'mail' event does nothing", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 50,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(1);

    pipeline.stop();
    emitServerEvent("mail");
    pipeline.trigger();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runs).toBe(1);
  });

  it("start() is idempotent — calling it twice does not double-subscribe", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
      debounceMs: 50,
      safetyIntervalMs: 60_000,
    });
    pipeline.start();
    pipeline.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(1);

    emitServerEvent("mail");
    await vi.advanceTimersByTimeAsync(50);
    expect(runs).toBe(2); // one listener, not two
    pipeline.stop();
  });

  it("stop() is idempotent and safe before start()", () => {
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {},
    });
    expect(() => {
      pipeline.stop();
      pipeline.stop();
    }).not.toThrow();
  });

  it("uses its own debounce/safety defaults when none are given", async () => {
    vi.useFakeTimers();
    let runs = 0;
    const pipeline = createMailReactivePipeline({
      name: "test",
      run: async () => {
        runs++;
      },
    });
    pipeline.start();
    // Default debounce is 2s — nothing yet at 1s.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runs).toBe(1);
    pipeline.stop();
  });
});
