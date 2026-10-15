import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { subscribeNewOrders, subscribeOrderStream } from "./new-order-events";
import { useSessionStore } from "../auth/stores/session";
import { refreshSession } from "../auth/api/session";

vi.mock("../../lib/api/client", () => ({
  api: { defaults: { baseURL: "https://api.example/api/v1" } },
}));
vi.mock("../auth/api/session", () => ({ refreshSession: vi.fn() }));
const fetchMock = vi.fn();
let stop: (() => void) | undefined;
let push: ReadableStreamDefaultController<Uint8Array>;
const refresh = vi.fn();
const status = vi.fn();
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function frame(event: string, shopId = "shop-a", workflow = "kitchen") {
  return `event: ${event}\ndata: ${JSON.stringify({ shopId, workflow })}\n\n`;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  useSessionStore.getState().setAccessToken("private-token");
  fetchMock.mockImplementation(async (_url, options: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = controller;
        options.signal?.addEventListener(
          "abort",
          () => controller.error(new Error("aborted")),
          { once: true },
        );
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
});
afterEach(async () => {
  stop?.();
  await flush();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("uses bearer headers and parses fragmented frames, filtering other shops/workflows", async () => {
  stop = subscribeNewOrders("shop-a", "kitchen", refresh, status);
  await flush();
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.example/api/v1/shops/shop-a/orders/events?workflow=kitchen",
    expect.objectContaining({
      headers: {
        Authorization: "Bearer private-token",
        Accept: "text/event-stream",
      },
    }),
  );
  const text =
    frame("resync") +
    frame("new_order", "shop-b") +
    frame("new_order", "shop-a", "cashier") +
    frame("new_order");
  const bytes = new TextEncoder().encode(text);
  push.enqueue(bytes.slice(0, 9));
  push.enqueue(bytes.slice(9));
  await flush();
  expect(refresh.mock.calls).toEqual([[false], [true]]);
  expect(status).toHaveBeenLastCalledWith("live");
});

it("delivers confirmation only for the subscribed customer shop and exact order", async () => {
  const events = vi.fn();
  stop = subscribeOrderStream(
    "/menu/cafe/orders/order-a/events",
    { shopId: "shop-a", orderId: "order-a" },
    "order_confirmed",
    () => "receipt-token",
    events,
    status,
  );
  await flush();
  const message = (shopId: string, orderId: string) =>
    `event: order_confirmed\ndata: ${JSON.stringify({ shopId, orderId })}\n\n`;
  push.enqueue(
    new TextEncoder().encode(
      message("shop-b", "order-a") +
        message("shop-a", "order-b") +
        message("shop-a", "order-a"),
    ),
  );
  await flush();
  expect(events).toHaveBeenCalledExactlyOnceWith("order_confirmed", {
    shopId: "shop-a",
    orderId: "order-a",
  });
  expect(fetchMock.mock.lastCall?.[1].headers.Authorization).toBe(
    "Bearer receipt-token",
  );
});

it("accepts confirmation and preparation on one receipt stream while filtering other orders", async () => {
  const events = vi.fn();
  stop = subscribeOrderStream(
    "/menu/cafe/orders/order-a/events",
    { shopId: "shop-a", orderId: "order-a" },
    ["order_confirmed", "order_preparing", "order_ready", "order_completed"],
    () => "receipt-token",
    events,
    status,
  );
  await flush();
  const message = (event: string, orderId = "order-a") =>
    `event: ${event}\ndata: ${JSON.stringify({ shopId: "shop-a", orderId })}\n\n`;
  push.enqueue(
    new TextEncoder().encode(
      message("order_confirmed") +
        message("order_preparing", "order-b") +
        message("order_preparing") +
        message("order_ready", "order-b") +
        message("order_ready") +
        message("order_completed", "order-b") +
        message("order_completed") +
        message("unknown"),
    ),
  );
  await flush();
  expect(events.mock.calls.map(([event]) => event)).toEqual([
    "order_confirmed",
    "order_preparing",
    "order_ready",
    "order_completed",
  ]);
});

it("reconnects and resynchronizes after a closed stream without inventing arrivals", async () => {
  stop = subscribeNewOrders("shop-a", "kitchen", refresh, status);
  await flush();
  push.close();
  await flush();
  expect(status).toHaveBeenLastCalledWith("retrying");
  await vi.advanceTimersByTimeAsync(3_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  push.enqueue(new TextEncoder().encode(frame("resync")));
  await flush();
  expect(refresh).toHaveBeenCalledExactlyOnceWith(false);
});

it("stops on denied access and requests an authorized refresh", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 403 }));
  stop = subscribeNewOrders("shop-a", "kitchen", refresh, status);
  await flush();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(status).toHaveBeenLastCalledWith("denied");
  expect(refresh).toHaveBeenCalledExactlyOnceWith(false);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it("refreshes expired credentials and reconnects with the replacement token", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.mocked(refreshSession).mockImplementation(async () => {
    useSessionStore.getState().setAccessToken("replacement-token");
    return { accessToken: "replacement-token" } as Awaited<
      ReturnType<typeof refreshSession>
    >;
  });
  stop = subscribeNewOrders("shop-a", "cashier", refresh, status);
  await flush();
  await vi.advanceTimersByTimeAsync(3_000);
  expect(refreshSession).toHaveBeenCalledOnce();
  expect(fetchMock.mock.lastCall?.[1].headers.Authorization).toBe(
    "Bearer replacement-token",
  );
});

it("aborts on logout and unmount without later reconnects or notifications", async () => {
  stop = subscribeNewOrders("shop-a", "kitchen", refresh, status);
  await flush();
  const signal = fetchMock.mock.lastCall?.[1].signal as AbortSignal;
  useSessionStore.getState().setAccessToken(null);
  await flush();
  expect(signal.aborted).toBe(true);
  stop();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(refresh).not.toHaveBeenCalled();
});

it("recovers a silent broken connection and keeps upstream failures visibly degraded", async () => {
  stop = subscribeNewOrders("shop-a", "kitchen", refresh, status);
  await flush();
  push.enqueue(new TextEncoder().encode(frame("unavailable")));
  await flush();
  expect(status).toHaveBeenLastCalledWith("retrying");
  await vi.advanceTimersByTimeAsync(38_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each(["product_sold_out", "product_available"] as const)(
  "opens %s streams without auth or cookies and filters foreign slugs",
  async (event) => {
    const events = vi.fn();
    stop = subscribeOrderStream(
      "/menu/cafe/availability-events",
      { shopSlug: "cafe" },
      event,
      () => null,
      events,
      status,
      false,
      true,
    );
    await flush();
    expect(fetchMock.mock.lastCall?.[1]).toMatchObject({
      headers: { Accept: "text/event-stream" },
      credentials: "omit",
    });
    expect(fetchMock.mock.lastCall?.[1].headers).not.toHaveProperty(
      "Authorization",
    );
    push.enqueue(
      new TextEncoder().encode(
        `event: ${event}\ndata: {"shopSlug":"other"}\n\nevent: ${event}\ndata: {"shopSlug":"cafe"}\n\n`,
      ),
    );
    await flush();
    expect(events).toHaveBeenCalledExactlyOnceWith(event, {
      shopSlug: "cafe",
    });
  },
);
