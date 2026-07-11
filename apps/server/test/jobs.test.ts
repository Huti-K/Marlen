import { describe, expect, it, vi } from "vitest";
import { JobLoop, KeyedJobs, mapWithConcurrency } from "../src/jobs.js";

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("returns results in input order", async () => {
    const results = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 5));
      return n * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never runs more than the limit at once", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
    );
    expect(peak).toBe(3);
  });

  it("propagates the first rejection", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });

  it("handles an empty list", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("KeyedJobs", () => {
  it("join shares the in-flight run for the same key", async () => {
    const jobs = new KeyedJobs();
    const gate = deferred<string>();
    let calls = 0;
    const run = () => {
      calls++;
      return gate.promise;
    };
    const first = jobs.join("a", run);
    const second = jobs.join("a", run);
    expect(jobs.isRunning("a")).toBe(true);
    gate.resolve("done");
    expect(await first).toBe("done");
    expect(await second).toBe("done");
    expect(calls).toBe(1);
    expect(jobs.isRunning("a")).toBe(false);
  });

  it("join runs different keys independently", async () => {
    const jobs = new KeyedJobs();
    const [a, b] = await Promise.all([
      jobs.join("a", async () => "a"),
      jobs.join("b", async () => "b"),
    ]);
    expect([a, b]).toEqual(["a", "b"]);
  });

  it("join runs again after the previous run settles, even on failure", async () => {
    const jobs = new KeyedJobs();
    await expect(
      jobs.join("a", async () => {
        throw new Error("first");
      }),
    ).rejects.toThrow("first");
    expect(await jobs.join("a", async () => "second")).toBe("second");
  });

  it("enqueue serializes calls per key and isolates failures", async () => {
    const jobs = new KeyedJobs();
    const order: string[] = [];
    const slow = jobs.enqueue("k", async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("slow");
    });
    const failing = jobs.enqueue("k", async () => {
      order.push("failing");
      throw new Error("mid");
    });
    const fast = jobs.enqueue("k", async () => {
      order.push("fast");
    });
    await slow;
    await expect(failing).rejects.toThrow("mid");
    await fast;
    expect(order).toEqual(["slow", "failing", "fast"]);
  });
});

describe("JobLoop", () => {
  it("runs once on start and again on each interval tick", async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const loop = new JobLoop({
        name: "test",
        run: async () => {
          runs++;
        },
        intervalMs: 1000,
      });
      loop.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(runs).toBe(1);
      // The interval tick schedules the (0ms) debounce at the window edge —
      // the clock has to move past it before it fires.
      await vi.advanceTimersByTimeAsync(1001);
      expect(runs).toBe(2);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces triggers while a run is pending or executing", async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const gate = deferred<void>();
      const loop = new JobLoop({
        name: "test",
        run: async () => {
          runs++;
          if (runs === 1) await gate.promise;
        },
        intervalMs: 60_000,
        debounceMs: 100,
      });
      loop.start();
      await vi.advanceTimersByTimeAsync(100);
      expect(runs).toBe(1);
      // Three triggers while the first run is blocked → exactly one follow-up.
      loop.trigger();
      loop.trigger();
      await vi.advanceTimersByTimeAsync(100);
      loop.trigger();
      gate.resolve();
      await vi.advanceTimersByTimeAsync(200);
      expect(runs).toBe(2);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps looping after a failed run", async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const loop = new JobLoop({
        name: "test",
        run: async () => {
          runs++;
          if (runs === 1) throw new Error("boom");
        },
        intervalMs: 1000,
      });
      loop.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1001);
      expect(runs).toBe(2);
      loop.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not run after stop, even from a queued trigger", async () => {
    vi.useFakeTimers();
    try {
      let runs = 0;
      const loop = new JobLoop({
        name: "test",
        run: async () => {
          runs++;
        },
        intervalMs: 1000,
        debounceMs: 50,
      });
      loop.start();
      await vi.advanceTimersByTimeAsync(50);
      expect(runs).toBe(1);
      loop.trigger();
      loop.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(runs).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
