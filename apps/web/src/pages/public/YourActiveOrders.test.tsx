import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
