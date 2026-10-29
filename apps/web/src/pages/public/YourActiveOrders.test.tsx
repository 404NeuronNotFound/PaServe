import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { YourActiveOrders } from "./YourActiveOrders";
import {
  readActiveOrders,
  rememberActiveOrder,
} from "../../features/orders/guest-tracking";

const id = "e47f6994-a303-4a7b-87b0-2386d5198828";
const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const seed = () =>
  rememberActiveOrder(
    "cafe",
    id,
    "ORD-000042",
    Date.parse("2030-01-01T00:00:00Z"),
  );
const show = () =>
  render(
    <MemoryRouter>
      <YourActiveOrders shopSlug="cafe" />
    </MemoryRouter>,
  );

it("bounds saved-order recovery and discards queued requests on navigation", async () => {
  for (let i = 0; i < 20; i++)
    rememberActiveOrder(
      "cafe",
      `e47f6994-a303-4a7b-87b0-${String(i).padStart(12, "0")}`,
      `ORD-${String(i + 1).padStart(6, "0")}`,
      Date.parse("2030-01-01T00:00:00Z"),
    );
  const finish: Array<(value: { ok: boolean }) => void> = [];
  fetchMock.mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)),
  );
  const view = show();
  expect(fetchMock).toHaveBeenCalledTimes(4);
  await act(async () => finish[0]({ ok: false }));
  expect(fetchMock).toHaveBeenCalledTimes(5);
  view.unmount();
  expect(
    fetchMock.mock.calls.every(([, options]) => options.signal.aborted),
  ).toBe(true);
  await act(async () =>
    finish.slice(1).forEach((resolve) => resolve({ ok: false })),
  );
  expect(fetchMock).toHaveBeenCalledTimes(5);
  expect(readActiveOrders("cafe")).toHaveLength(20);
});
it("reopens a saved order with cookie-based backend verification instead of trusting the local index", async () => {
  seed();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      order: {
        id,
        orderNumber: "ORD-000042",
        status: "CONFIRMED",
        preparationStatus: "QUEUED",
      },
      receipt: { shopSlug: "cafe" },
    }),
  });
  show();
  expect(
    await screen.findByRole("link", { name: "Your active order · ORD-000042" }),
  ).toHaveAttribute("href", `/menu/cafe/orders/${id}`);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    credentials: "include",
    cache: "no-store",
  });
});
it("removes completed orders and does not list another shop's saved orders", async () => {
  seed();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      order: {
        id,
        orderNumber: "ORD-000042",
        status: "CONFIRMED",
        preparationStatus: "COMPLETED",
      },
      receipt: { shopSlug: "cafe" },
    }),
  });
  show();
  await waitFor(() =>
    expect(screen.queryByRole("link")).not.toBeInTheDocument(),
  );
  expect(readActiveOrders("cafe")).toEqual([]);
  expect(readActiveOrders("other")).toEqual([]);
});
it("keeps staff-assistance guidance available when the tracking cookie is lost", async () => {
  seed();
  fetchMock.mockResolvedValue({ ok: false, status: 401 });
  show();
  expect(
    await screen.findByRole("link", { name: "Your saved order · ORD-000042" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/give the counter staff your order number/),
  ).toBeInTheDocument();
});

it.each(["focus", "online"])(
  "refreshes completed orders on %s instead of keeping a stale active link",
  async (event) => {
    seed();
    const saved = {
      id,
      orderNumber: "ORD-000042",
      status: "CONFIRMED",
      preparationStatus: "QUEUED",
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ order: saved, receipt: { shopSlug: "cafe" } }),
    });
    show();
    await screen.findByRole("link", { name: "Your active order · ORD-000042" });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        order: { ...saved, preparationStatus: "COMPLETED" },
        receipt: { shopSlug: "cafe" },
      }),
    });
    act(() => window.dispatchEvent(new Event(event)));
    await waitFor(() =>
      expect(screen.queryByRole("link")).not.toBeInTheDocument(),
    );
    expect(readActiveOrders("cafe")).toEqual([]);
  },
);

it("coalesces recovery events while a read is pending and drops queued work after unmount", async () => {
  seed();
  const response = (preparationStatus: string) => ({
    ok: true,
    json: async () => ({
      order: {
        id,
        orderNumber: "ORD-000042",
        status: "CONFIRMED",
        preparationStatus,
      },
      receipt: { shopSlug: "cafe" },
    }),
  });
  fetchMock.mockResolvedValue(response("QUEUED"));
  const view = show();
  await screen.findByRole("link", { name: "Your active order · ORD-000042" });
  let finish!: (value: ReturnType<typeof response>) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  await act(async () => {
    finish(response("COMPLETED"));
  });
  expect(readActiveOrders("cafe")).toHaveLength(1);
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
