import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import { AxiosError } from "axios";
import type {
  CurrentUserResponse,
  OwnerOrderDetailsResponse,
  ShopRole,
} from "@paserve/contracts";
import { currentUserKey } from "../../features/auth/api/session";
import { ActiveShopContext } from "../../features/shops/active-shop";
import {
  getOrderDetails,
  orderDetailsKey,
} from "../../features/orders/order-details";
import { orderDetailsFixture } from "../../features/orders/__fixtures__/order-details";
import {
  startPreparing,
  markReady,
  completeOrder,
} from "../../features/kitchen/queue";
import { OrderDetailsPage } from "./OrderDetailsPage";

vi.mock("../../features/orders/order-details", async (original) => ({
  ...(await original<typeof import("../../features/orders/order-details")>()),
  getOrderDetails: vi.fn(),
}));
vi.mock("../../features/kitchen/queue", () => ({
  startPreparing: vi.fn(),
  markReady: vi.fn(),
  completeOrder: vi.fn(),
}));
const setup = (role: ShopRole = "OWNER") => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(currentUserKey, {
    user: { id: "owner-a" },
  } as CurrentUserResponse);
  const view = (shopId = "shop-a", nextRole = role) => (
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider
        value={{
          id: "member",
          shopId,
          role: nextRole,
          shop: { id: shopId, name: "Cafe", slug: "cafe", isActive: true },
        }}
      >
        <MemoryRouter initialEntries={["/orders/order-a"]}>
          <Routes>
            <Route path="/orders/:orderId" element={<OrderDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </ActiveShopContext.Provider>
    </QueryClientProvider>
  );
  return { ...render(view()), client, view };
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getOrderDetails).mockResolvedValue(orderDetailsFixture());
  HTMLDialogElement.prototype.showModal = vi.fn(function (
    this: HTMLDialogElement,
  ) {
    this.open = true;
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

it("fails an offline action immediately instead of deferring it until reconnect", async () => {
  const data = orderDetailsFixture();
  data.order.preparationStatus = "READY";
  data.order.completedAt = null;
  data.order.permittedActions = ["COMPLETE"];
  vi.mocked(getOrderDetails).mockResolvedValue(data);
  vi.mocked(completeOrder).mockRejectedValue(new Error("Offline"));
  const { rerender, view, client } = setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark fulfilled" }),
  );
  onlineManager.setOnline(false);
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Mark fulfilled",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not be updated/,
  );
  expect(completeOrder).toHaveBeenCalledExactlyOnceWith("shop-a", "order-a");
  expect(
    client
      .getMutationCache()
      .getAll()
      .some((mutation) => mutation.state.isPaused),
  ).toBe(false);
  rerender(view("shop-b"));
  onlineManager.setOnline(true);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(completeOrder).toHaveBeenCalledOnce();
});

it("shows a readable fallback instead of a raw actor ID when names are unavailable", async () => {
  const data = orderDetailsFixture();
  for (const event of data.order.history) delete event.actorName;
  vi.mocked(getOrderDetails).mockResolvedValue(data);
  setup();
  await screen.findByRole("heading", { name: "ORD-000042" });
  expect(screen.getAllByText("Name unavailable")).toHaveLength(2);
  expect(screen.getByText("Customer submission")).toBeInTheDocument();
  expect(screen.queryByText(/Actor ID:/)).not.toBeInTheDocument();
});
it("labels automatic queuing separately from human actions", async () => {
  const data = orderDetailsFixture();
  data.order.history.splice(2, 0, {
    status: "QUEUED", at: data.order.paidAt!, actorId: null, actorName: null,
  });
  vi.mocked(getOrderDetails).mockResolvedValue(data);
  setup();
  await screen.findByRole("heading", { name: "ORD-000042" });
  expect(screen.getByText("System · Automatically queued")).toBeInTheDocument();
  expect(screen.getAllByText("Lia Navarro")).toHaveLength(2);
});

it("shows the saved full snapshot, totals, timestamps, payment and recorded actors", async () => {
  setup();
  await screen.findByRole("heading", { name: "ORD-000042" });
  expect(screen.getByText("2 × Original coffee")).toBeInTheDocument();
  expect(screen.getByText(/Large ·/)).toBeInTheDocument();
  expect(screen.getByText(/Oat milk ·/)).toBeInTheDocument();
  expect(screen.getByText("Customer note: Less ice")).toBeInTheDocument();
  expect(screen.getByText(/Dine-in · Table Patio 2/)).toBeInTheDocument();
  expect(screen.getAllByText("Lia Navarro")).toHaveLength(2);
  expect(screen.queryByText(/Actor ID:/)).not.toBeInTheDocument();
  expect(screen.getByText(/not a complete event log/)).toBeInTheDocument();
  expect(screen.getByText(/Amount received \(PHP\):/)).toHaveTextContent(
    "50.00",
  );
  expect(screen.getByText(/Change \(PHP\):/)).toHaveTextContent("14.00");
  expect(
    screen.queryByRole("button", { name: "Mark fulfilled" }),
  ).not.toBeInTheDocument();
});
it("opens the saved paid receipt and prints only after an explicit print request", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  setup();
  await screen.findByRole("button", { name: "View receipt" });
  expect(
    screen.queryByRole("region", { name: "Order receipt" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View receipt" }));
  expect(
    within(screen.getByRole("region", { name: "Order receipt" })).getByText(
      "2 × Original coffee",
    ),
  ).toBeInTheDocument();
  expect(print).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Print receipt" }));
  expect(print).toHaveBeenCalledOnce();
});
it("hands an unpaid pending order to the existing cashier workflow with its saved number", async () => {
  const data = orderDetailsFixture();
  Object.assign(data.order, {
    status: "PENDING_CONFIRMATION",
    paymentStatus: "UNPAID",
    preparationStatus: null,
    payment: null,
    paidAt: null,
    completedAt: null,
    permittedActions: ["CASHIER"],
  });
  vi.mocked(getOrderDetails).mockResolvedValue(data);
  setup();
  expect(
    await screen.findByRole("link", { name: "Review in cashier" }),
  ).toHaveAttribute("href", "/app/shops/shop-a/cashier?orderNumber=ORD-000042");
  expect(
    screen.queryByRole("button", { name: "View receipt" }),
  ).not.toBeInTheDocument();
});
it("keeps rejected legacy metadata auditable without invented history or actions", async () => {
  const data = orderDetailsFixture();
  Object.assign(data.order, {
    status: "REJECTED",
    paymentStatus: "UNPAID",
    preparationStatus: null,
    items: null,
    snapshotIssue: "Saved receipt details are unavailable.",
    payment: null,
    paidAt: null,
    completedAt: null,
    rejectionReason: null,
    history: [data.order.history[0]],
    permittedActions: [],
  });
  vi.mocked(getOrderDetails).mockResolvedValue(data);
  setup();
  expect(
    await screen.findByText("Rejection reason: Not captured"),
  ).toBeInTheDocument();
  expect(
    screen.getByText("No order actions are available in the current state."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Saved receipt details are unavailable."),
  ).toBeInTheDocument();
});
it.each([
  ["QUEUED", "START_PREPARING", "Start preparing", startPreparing],
  ["PREPARING", "MARK_READY", "Mark ready", markReady],
  ["READY", "COMPLETE", "Mark fulfilled", completeOrder],
] as const)(
  "confirms and executes the permitted %s action once, then refreshes details and lists",
  async (state, action, text, request) => {
    const data = orderDetailsFixture();
    data.order.preparationStatus = state;
    data.order.permittedActions = ["RECEIPT", action];
    data.order.completedAt = null;
    vi.mocked(getOrderDetails).mockResolvedValue(data);
    const { client } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    vi.mocked(request).mockResolvedValue({} as never);
    fireEvent.click(await screen.findByRole("button", { name: text }));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: text }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledExactlyOnceWith("shop-a", "order-a"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["owner-orders", "owner-a", "shop-a"],
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderDetailsKey("owner-a", "shop-a", "order-a"),
    });
  },
);
it("keeps failed state changes in the dialog and reloads authoritative status", async () => {
  const data = orderDetailsFixture();
  data.order.preparationStatus = "READY";
  data.order.permittedActions = ["COMPLETE"];
  vi.mocked(getOrderDetails).mockResolvedValue(data);
  vi.mocked(completeOrder).mockRejectedValue(new Error("Conflict"));
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark fulfilled" }),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Mark fulfilled",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /status or your access may have changed/,
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(getOrderDetails).toHaveBeenCalledTimes(2);
});
it("retries failed reads and hides previously loaded details after access is denied", async () => {
  vi.mocked(getOrderDetails).mockRejectedValueOnce(new Error("Offline"));
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByRole("heading", { name: "ORD-000042" });
  vi.mocked(getOrderDetails).mockRejectedValue(
    new AxiosError("Denied", "403", undefined, undefined, {
      status: 403,
    } as never),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /access has changed/,
  );
  expect(screen.queryByText("2 × Original coffee")).not.toBeInTheDocument();
});
it("does not fetch for another role and clears details when the shop or role changes", async () => {
  const { rerender, view } = setup("CASHIER");
  expect(screen.getByRole("alert")).toHaveTextContent(/Only this shop/);
  expect(getOrderDetails).not.toHaveBeenCalled();
  rerender(view("shop-a", "OWNER"));
  await screen.findByRole("heading", { name: "ORD-000042" });
  vi.mocked(getOrderDetails).mockImplementation(
    () => new Promise<OwnerOrderDetailsResponse>(() => {}),
  );
  rerender(view("shop-b", "OWNER"));
  expect(screen.queryByText("2 × Original coffee")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(getOrderDetails).toHaveBeenLastCalledWith(
      "shop-b",
      "order-a",
      expect.any(AbortSignal),
    ),
  );
});
