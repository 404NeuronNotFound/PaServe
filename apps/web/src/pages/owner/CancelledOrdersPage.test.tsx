import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import type {
  CancelledOrdersResponse,
  CurrentUserResponse,
  UserMembership,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getCancelledOrders } from "../../features/orders/cancelled-orders";
import { CancelledOrdersPage } from "./CancelledOrdersPage";

vi.mock("../../features/orders/cancelled-orders", async (original) => ({
  ...(await original<
    typeof import("../../features/orders/cancelled-orders")
  >()),
  getCancelledOrders: vi.fn(),
}));
const summary = (shopId = "a"): CancelledOrdersResponse => ({
  orders: [
    {
      id: "order-a",
      shopId,
      orderNumber: "ORD-000042",
      mode: "DINE_IN",
      tableNumber: "Patio 2",
      status: "REJECTED",
      paymentStatus: "UNPAID",
      preparationStatus: null,
      currency: "PHP",
      totalPrice: "1234567.89",
      createdAt: "2026-10-16T00:00:00.000Z",
      decidedAt: "2026-10-16T00:01:00.000Z",
      decidedBy: "saved-actor-id",
      rejectionReason: "Item unavailable",
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
      <ActiveShopContext.Provider
        value={{
          id: "member",
          shopId,
          role: nextRole,
          shop: { id: shopId, name: "Cafe", slug: "cafe", isActive: true },
        }}
      >
        <CancelledOrdersPage />
      </ActiveShopContext.Provider>
    </QueryClientProvider>
  );
  return { ...render(page()), page, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCancelledOrders).mockResolvedValue(summary());
});
afterEach(cleanup);

it("shows rejection accurately with captured reason/actor, saved total/table and Manila timestamps", async () => {
  setup();
  expect(await screen.findByText("ORD-000042")).toBeVisible();
  expect(
    screen.getByText("Rejected", { selector: ".active-order-badge" }),
  ).toBeVisible();
  expect(
    screen.getByText("Unpaid", { selector: ".active-order-payment" }),
  ).toBeVisible();
  expect(screen.getByText("Dine-in · Table Patio 2")).toBeVisible();
  expect(screen.getByText("Item unavailable")).toBeVisible();
  expect(screen.getByText("Recorded actor ID")).toBeVisible();
  expect(screen.getByText("saved-actor-id")).toBeVisible();
  expect(screen.getByText("₱1,234,567.89")).toBeVisible();
  expect(screen.getByText(/Oct 16, 2026.*08:01:00/)).toBeVisible();
  expect(screen.getByText("Newest placement first")).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
});
it("shows Not captured for missing reason, actor and decision time without hiding the order", async () => {
  const data = summary();
  Object.assign(data.orders[0], {
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    mode: "TAKEOUT",
    tableNumber: null,
  });
  vi.mocked(getCancelledOrders).mockResolvedValue(data);
  setup();
  await screen.findByText("ORD-000042");
  expect(screen.getAllByText("Not captured")).toHaveLength(3);
  expect(
    screen.getByText("Takeout", { selector: ".active-order-identity p" }),
  ).toBeVisible();
});
it("renders a captured reason as plain text", async () => {
  const data = summary();
  data.orders[0].rejectionReason = "<img src=x onerror=alert(1)>";
  vi.mocked(getCancelledOrders).mockResolvedValue(data);
  setup();
  expect(await screen.findByText("<img src=x onerror=alert(1)>")).toBeVisible();
  expect(document.querySelector(".cancelled-order-decision img")).toBeNull();
});
it("shows an empty history with no next page", async () => {
  vi.mocked(getCancelledOrders).mockResolvedValue({
    orders: [],
    nextCursor: null,
  });
  setup();
  expect(await screen.findByText("No rejected orders yet")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});
it("pages Next/Previous and restarts at the first page on refresh", async () => {
  vi.mocked(getCancelledOrders).mockImplementation(async (_shop, cursor) =>
    cursor
      ? { orders: [], nextCursor: null }
      : { ...summary(), nextCursor: "next" },
  );
  setup();
  await screen.findByText("ORD-000042");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("No rejected orders on this page");
  expect(getCancelledOrders).toHaveBeenLastCalledWith(
    "a",
    "next",
    expect.any(AbortSignal),
    "",
    {},
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("ORD-000042");
  expect(getCancelledOrders).toHaveBeenLastCalledWith(
    "a",
    null,
    expect.any(AbortSignal),
    "",
    {},
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("No rejected orders on this page");
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("ORD-000042");
  expect(getCancelledOrders).toHaveBeenLastCalledWith(
    "a",
    null,
    expect.any(AbortSignal),
    "",
    {},
  );
});
it("refreshes history automatically when an order is rejected", async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(getCancelledOrders).mockResolvedValueOnce({
      orders: [],
      nextCursor: null,
    });
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByText("No rejected orders yet")).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15001);
    });
    expect(screen.getByText("ORD-000042")).toBeVisible();
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
it("hides stale history on refresh failure and recovers with retry", async () => {
  setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getCancelledOrders).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.queryByText("Item unavailable")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("ORD-000042")).toBeVisible();
});
it("withholds history after access revocation", async () => {
  setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getCancelledOrders).mockRejectedValue(
    new AxiosError("Forbidden", "403", undefined, undefined, {
      status: 403,
    } as never),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your access to this shop’s orders is unavailable.",
  );
  expect(screen.queryByText("saved-actor-id")).not.toBeInTheDocument();
});
it("resets history on shop, account and role changes", async () => {
  const view = setup();
  await screen.findByText("ORD-000042");
  vi.mocked(getCancelledOrders).mockImplementation(() => new Promise(() => {}));
  view.rerender(view.page("b"));
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading cancelled / rejected orders",
  );
  view.client.setQueryData(currentUserKey, {
    user: { id: "owner-b" },
  } as CurrentUserResponse);
  view.rerender(view.page("b"));
  expect(screen.queryByText("saved-actor-id")).not.toBeInTheDocument();
  view.rerender(view.page("b", "CASHIER"));
  expect(screen.getByRole("alert")).toHaveTextContent("Only this shop’s owner");
});
it.each<UserMembership["role"]>(["ADMIN", "MANAGER", "CASHIER", "KITCHEN"])(
  "does not fetch for %s",
  (role) => {
    setup(role);
    expect(getCancelledOrders).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only this shop’s owner",
    );
  },
);
