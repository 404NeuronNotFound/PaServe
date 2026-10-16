import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type {
  ActiveOrdersResponse,
  CurrentUserResponse,
  UserMembership,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getActiveOrders } from "../../features/orders/active-orders";
import { ActiveOrdersPage } from "./ActiveOrdersPage";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../features/orders/active-orders", async (original) => ({
  ...(await original<typeof import("../../features/orders/active-orders")>()),
  getActiveOrders: vi.fn(),
}));
const summary = (shopId = "a"): ActiveOrdersResponse => ({
  orders: [
    {
      id: "order-a",
      shopId,
      orderNumber: "ORD-000042",
      mode: "DINE_IN",
      tableNumber: "Patio 2",
      status: "PENDING_CONFIRMATION",
      paymentStatus: "UNPAID",
      preparationStatus: null,
      currency: "PHP",
      totalPrice: "1234567.89",
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:05:00.000Z",
    },
  ],
  nextCursor: null,
});
function setup(role: UserMembership["role"] = "OWNER") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserKey, {
    user: { id: "owner-a" },
  } as CurrentUserResponse);
  const page = (shopId = "a", nextRole = role) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActiveShopContext.Provider
          value={{
            id: "member",
            shopId,
            role: nextRole,
            shop: { id: shopId, name: "Cafe", slug: "cafe", isActive: true },
          }}
        >
          <ActiveOrdersPage />
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(page()), page, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getActiveOrders).mockResolvedValue(summary());
});
afterEach(cleanup);

it("shows approval/payment, placed and updated Manila times, order age, type/table and exact total", async () => {
  setup();
  expect(await screen.findByText("ORD-000042")).toBeVisible();
  expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
    "href",
    "/app/shops/a/orders/order-a",
  );
  expect(
    screen.getByText("Pending confirmation", {
      selector: ".active-order-badge",
    }),
  ).toBeVisible();
  expect(screen.getByText("Unpaid")).toBeVisible();
  expect(screen.getByText("Dine-in · Table Patio 2")).toBeVisible();
  expect(screen.getByText("₱1,234,567.89")).toBeVisible();
  expect(screen.getByText(/Oct 16, 2026.*08:00:00/)).toBeVisible();
  expect(screen.getByText(/Oct 16, 2026.*08:05:00/)).toBeVisible();
  expect(screen.getByText("Order age")).toBeVisible();
});
it.each(["QUEUED", "PREPARING", "READY"] as const)(
  "shows %s with independent confirmed and paid states and takeout",
  async (preparationStatus) => {
    const data = summary();
    Object.assign(data.orders[0], {
      status: "CONFIRMED",
      paymentStatus: "PAID",
      preparationStatus,
      mode: "TAKEOUT",
      tableNumber: null,
    });
    vi.mocked(getActiveOrders).mockResolvedValue(data);
    setup();
    expect(
      await screen.findByText(
        preparationStatus[0] + preparationStatus.slice(1).toLowerCase(),
        { selector: ".active-order-badge" },
      ),
    ).toBeVisible();
    expect(screen.getByText("Confirmed · Paid")).toBeVisible();
    expect(
      screen.getByText("Takeout", { selector: ".active-order-identity p" }),
    ).toBeVisible();
  },
);
it("shows a useful empty state", async () => {
  vi.mocked(getActiveOrders).mockResolvedValue({
    orders: [],
    nextCursor: null,
  });
  setup();
  expect(await screen.findByText("No active orders right now")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});

it.each([
  ["UNPAID", "Awaiting payment", "Confirmed · Unpaid"],
  ["PAID", "Awaiting preparation", "Confirmed · Paid"],
] as const)(
  "labels confirmed %s orders without a preparation state accurately",
  async (paymentStatus, label, paymentLabel) => {
    const data = summary();
    Object.assign(data.orders[0], { status: "CONFIRMED", paymentStatus });
    vi.mocked(getActiveOrders).mockResolvedValue(data);
    setup();
    expect(
      await screen.findByText(label, { selector: ".active-order-badge" }),
    ).toBeVisible();
    expect(screen.getByText(paymentLabel)).toBeVisible();
  },
);

it("replaces the displayed status with the current status after manual refetch", async () => {
  setup();
  await screen.findByText("Pending confirmation", {
    selector: ".active-order-badge",
  });
  const data = summary();
  Object.assign(data.orders[0], {
    status: "CONFIRMED",
    paymentStatus: "PAID",
    preparationStatus: "READY",
  });
  vi.mocked(getActiveOrders).mockResolvedValue(data);
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(
    await screen.findByText("Ready", { selector: ".active-order-badge" }),
  ).toBeVisible();
  expect(screen.getByText("Confirmed · Paid")).toBeVisible();
  expect(
    screen.queryByText("Pending confirmation", {
      selector: ".active-order-badge",
    }),
  ).not.toBeInTheDocument();
});

it("returns to the preceding page using its original cursor", async () => {
  vi.mocked(getActiveOrders)
    .mockResolvedValueOnce({ ...summary(), nextCursor: "next" })
    .mockResolvedValueOnce({ orders: [], nextCursor: null })
    .mockResolvedValue(summary());
  setup();
  await screen.findByText("ORD-000042");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("No active orders on this page");
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("ORD-000042")).toBeVisible();
  expect(getActiveOrders).toHaveBeenLastCalledWith(
    "a",
    null,
    expect.any(AbortSignal),
    "",
    {},
  );
});

it("refreshes automatically so fulfilled orders leave the view", async () => {
  vi.useFakeTimers();
  try {
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("ORD-000042")).toBeVisible();
    vi.mocked(getActiveOrders).mockResolvedValue({
      orders: [],
      nextCursor: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
    expect(screen.getByText("No active orders right now")).toBeVisible();
    expect(getActiveOrders).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
it("pages with the captured cursor and refreshes back to the first page", async () => {
  vi.mocked(getActiveOrders)
    .mockResolvedValueOnce({ ...summary(), nextCursor: "next" })
    .mockResolvedValue({ orders: [], nextCursor: null });
  setup();
  await screen.findByText("ORD-000042");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(
    await screen.findByText("No active orders on this page"),
  ).toBeVisible();
  expect(getActiveOrders).toHaveBeenLastCalledWith(
    "a",
    "next",
    expect.any(AbortSignal),
    "",
    {},
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() =>
    expect(getActiveOrders).toHaveBeenLastCalledWith(
      "a",
      null,
      expect.any(AbortSignal),
      "",
      {},
    ),
  );
});
it("hides previously loaded orders after a failed refresh and allows retry", async () => {
  setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getActiveOrders).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("ORD-000042")).toBeVisible();
});
it("withholds data after access revocation", async () => {
  setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getActiveOrders).mockRejectedValue(
    new AxiosError("Forbidden", "403", undefined, undefined, {
      status: 403,
    } as never),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your access to this shop’s orders is unavailable.",
  );
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
});
it("clears visible orders immediately on shop switch and role downgrade", async () => {
  const view = setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getActiveOrders).mockImplementation(() => new Promise(() => {}));
  view.rerender(view.page("b"));
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading active orders");
  view.rerender(view.page("b", "CASHIER"));
  expect(screen.getByRole("alert")).toHaveTextContent("Only this shop’s owner");
});
it.each<UserMembership["role"]>(["ADMIN", "MANAGER", "CASHIER", "KITCHEN"])(
  "does not fetch for %s",
  (role) => {
    setup(role);
    expect(getActiveOrders).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only this shop’s owner",
    );
  },
);
