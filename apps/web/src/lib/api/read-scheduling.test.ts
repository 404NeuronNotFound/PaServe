import { afterEach, expect, it, vi } from "vitest";
import { mapConcurrentReads, readTogether } from "./read-scheduling";

afterEach(() => vi.useRealTimers());

it("starts independent reads together and preserves their result order", async () => {
  let release!: (value: string) => void;
  const first = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const second = vi.fn(async () => 42);
  const result = readTogether([first, second]);
  await Promise.resolve();
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledOnce();
  release("first");
  expect(await result).toEqual(["first", 42]);
});

it("aborts unfinished siblings and preserves the original failed-read error", async () => {
  let sibling!: AbortSignal;
  const denied = new Error("Permission denied");
  await expect(
    readTogether([
      async () => {
        throw denied;
      },
      (signal) =>
        new Promise((_, reject) => {
          sibling = signal;
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    ]),
  ).rejects.toBe(denied);
  expect(sibling.aborted).toBe(true);
});

it.each(["deadline", "navigation"])(
  "cancels an unfinished read group on %s",
  async (reason) => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const result = readTogether(
      [
        (signal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          }),
      ],
      parent.signal,
    );
    const rejected = expect(result).rejects.toThrow();
    await Promise.resolve();
    if (reason === "deadline") await vi.advanceTimersByTimeAsync(15_000);
    else parent.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("never starts reads when the parent is already cancelled", async () => {
  const parent = new AbortController();
  parent.abort();
  const read = vi.fn();
  await expect(readTogether([read], parent.signal)).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});

it("releases the deadline timer after successful reads", async () => {
  vi.useFakeTimers();
  await readTogether([async () => "ready"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds twenty reads to four concurrent requests and retains input order", async () => {
  let active = 0,
    peak = 0;
  const results = await mapConcurrentReads(
    Array.from({ length: 20 }, (_, i) => i),
    async (i) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return i * 2;
    },
    new AbortController().signal,
  );
  expect(peak).toBe(4);
  expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
});

it("drops queued reads after cancellation, even when active reads resolve late", async () => {
  const controller = new AbortController();
  const releases: Array<() => void> = [];
  const read = vi.fn(
    () => new Promise<void>((resolve) => releases.push(resolve)),
  );
  const result = mapConcurrentReads(
    Array.from({ length: 20 }),
    read,
    controller.signal,
  );
  const rejected = expect(result).rejects.toThrow();
  expect(read).toHaveBeenCalledTimes(4);
  controller.abort();
  releases.forEach((release) => release());
  await rejected;
  expect(read).toHaveBeenCalledTimes(4);
});
