import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  forgetActiveOrder,
  readActiveOrders,
  redeemTrackingLink,
  rememberActiveOrder,
} from "./guest-tracking";
vi.mock("../../lib/api/client", () => ({
  api: { defaults: { baseURL: "/api/v1" } },
}));

const id = "e47f6994-a303-4a7b-87b0-2386d5198828";
const expiry = Date.parse("2030-01-01T00:00:00Z");
const token = `${Buffer.from(JSON.stringify({ purpose: "order-tracking", orderId: id })).toString("base64url")}.${"a".repeat(43)}`;
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("persists only bounded per-shop navigation hints, deduplicates orders and filters invalid/expired data", () => {
  rememberActiveOrder("cafe", id, "ORD-000042", expiry);
  rememberActiveOrder("cafe", id, "ORD-000042", expiry);
  expect(readActiveOrders("cafe")).toEqual([
    { id, orderNumber: "ORD-000042", expiresAt: expiry },
  ]);
  expect(readActiveOrders("other")).toEqual([]);
  expect(localStorage.getItem("paserve-active-orders:v1:cafe")).not.toContain(
    token,
  );
  rememberActiveOrder("cafe", "../other", "ORD-000042", expiry);
  expect(readActiveOrders("cafe")).toHaveLength(1);
  forgetActiveOrder("cafe", id);
  expect(readActiveOrders("cafe")).toEqual([]);
  rememberActiveOrder("cafe", id, "ORD-000042", expiry);
  vi.spyOn(Date, "now").mockReturnValue(expiry);
  expect(readActiveOrders("cafe")).toEqual([]);
});

it("keeps navigation usable in memory when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  rememberActiveOrder("blocked-cafe", id, "ORD-000042", expiry);
  expect(readActiveOrders("blocked-cafe")).toHaveLength(1);
});

it("ignores corrupt ID objects and duplicate navigation hints without crashing", () => {
  const valid = { id, orderNumber: "ORD-000042", expiresAt: expiry };
  localStorage.setItem(
    "paserve-active-orders:v1:cafe",
    JSON.stringify([
      { ...valid, id: { toString: null, valueOf: null } },
      valid,
      valid,
    ]),
  );
  expect(readActiveOrders("cafe")).toEqual([valid]);
});

it("removes a second private fragment immediately and serializes its exchange behind an in-flight redemption", async () => {
  let finish!: (response: { ok: boolean }) => void;
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(
    {},
    "",
    `/menu/cafe/orders/${id}#tracking=${token}`,
  );
  const first = redeemTrackingLink("cafe", id);
  await Promise.resolve();
  const secondToken = token.replace(/a$/, "b");
  window.history.replaceState(
    {},
    "",
    `/menu/cafe/orders/${id}#tracking=${secondToken}`,
  );
  const second = redeemTrackingLink("cafe", id);
  try {
    expect(window.location.hash).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    finish({ ok: true });
    await Promise.all([first, second]);
  }
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
    `Bearer ${secondToken}`,
  );
});

it("removes the private fragment before exchanging its credential, coalesces redemption and stores no secret", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(
    {},
    "",
    `/menu/cafe/orders/${id}#tracking=${token}`,
  );
  const first = redeemTrackingLink("cafe", id);
  expect(window.location.hash).toBe("");
  expect(redeemTrackingLink("cafe", id)).toBe(first);
  await first;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe(`/api/v1/menu/cafe/orders/${id}/tracking-session`);
  expect(url).not.toContain(token);
  expect(options).toMatchObject({
    method: "POST",
    credentials: "include",
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(localStorage.length).toBe(0);
});

it("rejects a malformed private fragment after removing it from the address bar", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(
    {},
    "",
    `/menu/cafe/orders/${id}#tracking=%broken`,
  );
  await expect(redeemTrackingLink("cafe", id)).rejects.toThrow();
  expect(window.location.hash).toBe("");
  expect(fetchMock).not.toHaveBeenCalled();
});
