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
  CompletedOrdersResponse,
  CurrentUserResponse,
  UserMembership,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getCompletedOrders } from "../../features/orders/completed-orders";
import { CompletedOrdersPage } from "./CompletedOrdersPage";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../features/orders/completed-orders", async (original) => ({
  ...(await original<
    typeof import("../../features/orders/completed-orders")
  >()),
  getCompletedOrders: vi.fn(),
}));
const summary = (shopId = "a"): CompletedOrdersResponse => ({
  orders: [
    {
      id: "order-a",
      shopId,
      orderNumber: "ORD-000042",
      mode: "DINE_IN",
      tableNumber: "Patio 2",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      preparationStatus: "COMPLETED",
      paymentMethod: "CASH",
      currency: "PHP",
      totalPrice: "1234567.89",
      createdAt: "2026-10-16T00:00:00.000Z",
      paidAt: "2026-10-16T00:01:00.000Z",
      completedAt: "2026-10-16T00:05:00.000Z",
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
          <CompletedOrdersPage />
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(page()), page, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCompletedOrders).mockResolvedValue(summary());
});
afterEach(cleanup);

it("announces newer history without moving records until the user refreshes", async () => {
  const snapshot = "2026-10-17T00:00:00.000Z";
  let hasNew = false;
  vi.mocked(getCompletedOrders).mockImplementation(async () => ({
    ...summary(), pagination: { page: 1, pageSize: 12, pageCount: 1, total: 1, snapshot, hasNew },
  }));
  const { client } = setup();
  await screen.findByText("ORD-000042");
  hasNew = true;
  await act(() => client.invalidateQueries({ queryKey: ["owner-orders"] }));
  expect(await screen.findByText("New orders available.")).toBeVisible();
  expect(screen.getByText("ORD-000042")).toBeVisible();
  expect(getCompletedOrders).toHaveBeenLastCalledWith("a", null, expect.any(AbortSignal), "", {}, { page: 1, snapshot });
  hasNew = false;
  fireEvent.click(screen.getByRole("button", { name: "Show new orders" }));
  await waitFor(() => expect(screen.queryByText("New orders available.")).not.toBeInTheDocument());
  expect(getCompletedOrders).toHaveBeenLastCalledWith("a", null, expect.any(AbortSignal), "", {}, { page: 1 });
});

it("shows fulfilled history, saved table/amount, recorded payment and Manila completion time", async () => {
  setup();
  expect(await screen.findByText("ORD-000042")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "View details / receipt" }),
  ).toHaveAttribute("href", "/app/shops/a/orders/order-a");
  expect(
    screen.getByText("Fulfilled", { selector: ".active-order-badge" }),
  ).toBeVisible();
  expect(screen.getByText("Confirmed · Paid")).toBeVisible();
  expect(screen.getByText("Dine-in · Table Patio 2 · Table service")).toBeVisible();
  expect(
    screen.getByText("Cash", { selector: ".active-order-payment" }),
  ).toBeVisible();
  expect(screen.getAllByText("₱1,234,567.89")).toHaveLength(2);
  expect(screen.getByText(/Oct 16, 2026.*08:05:00/)).toBeVisible();
  expect(screen.getByText("Newest completions first")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
});
it.each([
  ["GCASH_MANUAL", "GCash (manual)"],
  ["CARD_MANUAL", "Card (manual)"],
  ["OTHER", "Other"],
] as const)(
  "shows recorded %s payments and takeout",
  async (paymentMethod, label) => {
    const data = summary();
    Object.assign(data.orders[0], {
      paymentMethod,
      mode: "TAKEOUT",
      tableNumber: null,
    });
    vi.mocked(getCompletedOrders).mockResolvedValue(data);
    setup();
    expect(
      await screen.findByText(label, { selector: ".active-order-payment" }),
    ).toBeVisible();
    expect(
      screen.getByText("Takeout", { selector: ".active-order-identity p" }),
    ).toBeVisible();
  },
);
it("sums only the current page using exact cents", async () => {
  const data = summary();
  data.orders[0].totalPrice = "0.10";
  data.orders.push({
    ...data.orders[0],
    id: "order-b",
    orderNumber: "ORD-000043",
    totalPrice: "0.20",
  });
  vi.mocked(getCompletedOrders).mockResolvedValue(data);
  setup();
  expect(await screen.findByText("₱0.30")).toBeVisible();
  expect(screen.getByText(/Total on this page/)).toBeVisible();
});
it("shows an empty history with no next page", async () => {
  vi.mocked(getCompletedOrders).mockResolvedValue({
    orders: [],
    nextCursor: null,
  });
  setup();
  expect(await screen.findByText("No completed orders yet")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(screen.getByText("₱0.00")).toBeVisible();
});
it("jumps to numbered history pages and keeps the server snapshot until refresh", async () => {
  const snapshot = "2026-10-17T00:00:00.000Z";
  vi.mocked(getCompletedOrders).mockImplementation(async (_shop, _cursor, _signal, _search, _filters, request) => {
    const page = request?.page ?? 1;
    return {
      orders: Array.from({ length: page === 4 ? 1 : 12 }, (_, index) => ({
        ...summary().orders[0], id: `order-${page}-${index}`,
        orderNumber: `ORD-${String(page * 100 + index + 1).padStart(6, "0")}`,
      })),
      nextCursor: null,
      pagination: { page, pageCount: 4, pageSize: 12, total: 37, snapshot, hasNew: false },
    };
  });
  setup();
  await screen.findByText("ORD-000101");
  fireEvent.click(screen.getByRole("button", { name: "Go to page 4" }));
  await screen.findByText("ORD-000401");
  expect(screen.queryByText("ORD-000101")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(getCompletedOrders).toHaveBeenLastCalledWith("a", null, expect.any(AbortSignal), "", {}, { page: 4, snapshot });
  fireEvent.click(screen.getByRole("button", { name: "Go to page 1" }));
  await screen.findByText("ORD-000101");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("ORD-000201");
  expect(getCompletedOrders).toHaveBeenLastCalledWith("a", null, expect.any(AbortSignal), "", {}, { page: 2, snapshot });
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("ORD-000101");
  expect(getCompletedOrders).toHaveBeenLastCalledWith("a", null, expect.any(AbortSignal), "", {}, { page: 1 });
});

it("refreshes history automatically when another order is fulfilled", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(getCompletedOrders).mockResolvedValueOnce({
      orders: [],
      nextCursor: null,
    });
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("No completed orders yet")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByText("ORD-000042")).toBeVisible();
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
it("hides stale history and its page total on refresh failure, then recovers", async () => {
  setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getCompletedOrders).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.queryByText(/Total on this page/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("ORD-000042")).toBeVisible();
});
it("withholds history after access revocation", async () => {
  setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getCompletedOrders).mockRejectedValue(
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
it("resets history and paging on shop, account and role changes", async () => {
  const view = setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getCompletedOrders).mockImplementation(() => new Promise(() => {}));
  view.rerender(view.page("b"));
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(getCompletedOrders).toHaveBeenLastCalledWith(
      "b",
      null,
      expect.any(AbortSignal),
      "",
      {},
      { page: 1 },
    ),
  );
  view.client.setQueryData(currentUserKey, {
    user: { id: "owner-b" },
  } as CurrentUserResponse);
  view.rerender(view.page("b"));
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  view.rerender(view.page("b", "CASHIER"));
  expect(screen.getByRole("alert")).toHaveTextContent("Only this shop’s owner");
});
it.each<UserMembership["role"]>(["ADMIN", "MANAGER", "CASHIER", "KITCHEN"])(
  "does not fetch for %s",
  (role) => {
    setup(role);
    expect(getCompletedOrders).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only this shop’s owner",
    );
  },
);
