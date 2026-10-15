import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError } from "axios";
import type {
  PreparationQueueResponse,
  UserMembership,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { getShopMembership } from "../../features/shops/api/context";
import { api } from "../../lib/api/client";
import { KitchenRoute } from "../../features/kitchen/KitchenRoute";
import { KitchenPage } from "./KitchenPage";

vi.mock("../../features/shops/api/context", () => ({
  getShopMembership: vi.fn(),
}));
vi.mock("../../lib/api/client", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
  AUTH_REQUEST_TIMEOUT_MS: 15000,
}));
const member = (role: UserMembership["role"]): UserMembership => ({
  id: "m",
  shopId: "shop-a",
  role,
  shop: { id: "shop-a", name: "Cafe A", slug: "cafe-a", isActive: true },
});
const ticket = (
  id = "first",
  number = "ORD-000001",
  queuedAt = "2026-10-15T01:00:00.000Z",
): PreparationQueueResponse["orders"][number] => ({
  id,
  shopId: "shop-a",
  orderNumber: number,
  mode: "DINE_IN",
  tableNumber: "Patio 2",
  currency: "PHP",
  totalPrice: "150.00",
  queuedAt,
  preparationStatus: "QUEUED",
  items: [
    {
      productId: "p",
      productName: "Iced latte",
      quantity: 2,
      currency: "PHP",
      basePrice: "60.00",
      unitPrice: "75.00",
      totalPrice: "150.00",
      variants: [
        {
          id: "v",
          name: "Large",
          optionGroupId: "size",
          isDefault: false,
          priceAdjustment: "10.00",
        },
      ],
      addOns: [{ id: "a", name: "Oat milk", priceAdjustment: "5.00" }],
      notes: "No ice, please",
    },
  ],
});
afterEach(() => vi.resetAllMocks());
function setup(
  role: UserMembership["role"] = "KITCHEN",
  orders = [ticket()],
  nextCursor: string | null = null,
) {
  vi.mocked(getShopMembership).mockResolvedValue(member(role));
  vi.mocked(api.get).mockResolvedValue({ data: { orders, nextCursor } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["auth", "me"], { user: { id: "user-a" } });
  render(
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider value={member("OWNER")}>
        <MemoryRouter initialEntries={["/app/shops/shop-a/kitchen"]}>
          <Routes>
            <Route path="/app/shops/:shopId/kitchen" element={<KitchenRoute />}>
              <Route index element={<KitchenPage />} />
            </Route>
            <Route path="/login" element={<h1>Sign in</h1>} />
          </Routes>
        </MemoryRouter>
      </ActiveShopContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}
it.each(["KITCHEN", "OWNER", "ADMIN", "MANAGER"] as const)(
  "shows real preparation details for %s",
  async (role) => {
    setup(role);
    const order = await screen.findByRole("article", {
      name: "Order ORD-000001",
    });
    for (const text of [
      "Table Patio 2",
      "Dine-in",
      "Iced latte",
      "Large",
      "+ Oat milk",
      "No ice, please",
      "2 items",
    ])
      expect(within(order).getByText(text)).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      "/shops/shop-a/preparation/queue",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  },
);
it("denies cashier access even when the outer context is owner", async () => {
  setup("CASHIER");
  expect(
    await screen.findByRole("heading", { name: "Kitchen access required" }),
  ).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
it("orders tickets chronologically and distinguishes pickup", async () => {
  setup("KITCHEN", [
    {
      ...ticket("later", "ORD-000002", "2026-10-15T02:00:00.000Z"),
      mode: "TAKEOUT",
      tableNumber: null,
    },
    ticket(),
  ]);
  await screen.findByRole("article", { name: "Order ORD-000001" });
  const orders = screen.getAllByRole("article");
  expect(orders[0]).toHaveAccessibleName("Order ORD-000001");
  expect(within(orders[0]).getByText("Oldest ticket")).toBeInTheDocument();
  expect(within(orders[1]).getByText("Pickup")).toBeInTheDocument();
});
it("shows an honest empty state", async () => {
  setup("KITCHEN", []);
  expect(
    await screen.findByText("A little room to breathe."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it("represents queued work as cashier accepted and paid with preparation not started", async () => {
  setup();
  const order = await screen.findByRole("article", {
    name: "Order ORD-000001",
  });
  expect(
    screen.getByText(
      "Accepted by cashier and paid. Preparation has not started.",
    ),
  ).toBeInTheDocument();
  expect(within(order).getByText("QUEUED · NOT STARTED")).toBeInTheDocument();
  expect(
    within(order).getByText("Cashier accepted · Paid"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("list", { name: "New orders, oldest first" }),
  ).toHaveAccessibleDescription(
    "Waiting for kitchen / barista to begin preparation.",
  );
});
it("removes a ticket on refresh when it no longer belongs to queued work", async () => {
  setup();
  await screen.findByRole("article", { name: "Order ORD-000001" });
  vi.mocked(api.get).mockResolvedValueOnce({
    data: { orders: [], nextCursor: null },
  });
  await userEvent.click(screen.getByRole("button", { name: "Refresh orders" }));
  expect(
    await screen.findByText("A little room to breathe."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it("loads the next cursor without duplicating tickets", async () => {
  setup("KITCHEN", [ticket()], "cursor123");
  const more = await screen.findByRole("button", { name: "Load more orders" });
  vi.mocked(api.get).mockResolvedValueOnce({
    data: {
      orders: [ticket(), ticket("second", "ORD-000002")],
      nextCursor: null,
    },
  });
  await userEvent.click(more);
  await screen.findByRole("article", { name: "Order ORD-000002" });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(api.get).toHaveBeenLastCalledWith(
    "/shops/shop-a/preparation/queue",
    expect.objectContaining({ params: { cursor: "cursor123" } }),
  );
});
it("keeps a confirmed paid ticket visible exactly once across repeated refreshes", async () => {
  setup();
  await screen.findByRole("article", { name: "Order ORD-000001" });
  for (let index = 0; index < 3; index++) {
    await userEvent.click(
      screen.getByRole("button", { name: "Refresh orders" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Refresh orders" }),
      ).toBeEnabled(),
    );
    expect(
      screen.getAllByRole("article", { name: "Order ORD-000001" }),
    ).toHaveLength(1);
  }
  expect(api.get).toHaveBeenCalledTimes(4);
});
it("starts a ticket and shows its saved preparation time in Preparing", async () => {
  setup();
  const button = await screen.findByRole("button", {
    name: "Start preparing ORD-000001",
  });
  const prepared = {
    ...ticket(),
    preparationStatus: "PREPARING",
    preparationStartedAt: "2026-10-15T01:05:00.000Z",
    preparationStartedBy: "user-a",
  };
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(button);
  expect(button).toBeDisabled();
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      orders: String(url).endsWith("/preparing") ? [prepared] : [],
      nextCursor: null,
    },
  }));
  await act(async () =>
    finish({ data: { order: prepared, alreadyStarted: false } }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("article")).not.toBeInTheDocument(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
  const order = await screen.findByRole("article", {
    name: "Order ORD-000001",
  });
  expect(
    within(order).getByText("PREPARING · IN PROGRESS"),
  ).toBeInTheDocument();
  expect(
    order.querySelector('time[datetime="2026-10-15T01:05:00.000Z"]'),
  ).toBeInTheDocument();
  expect(
    within(order).queryByRole("button", { name: /Start preparing/ }),
  ).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith(
    "/shops/shop-a/orders/first/start-preparing",
    {},
    expect.any(Object),
  );
});
it("keeps a ticket and exposes recovery when preparation start fails", async () => {
  setup();
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Connection lost"));
  await userEvent.click(
    await screen.findByRole("button", { name: "Start preparing ORD-000001" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t confirm preparation start",
  );
  expect(screen.getByRole("article")).toBeInTheDocument();
});
it.each(["DINE_IN", "TAKEOUT"] as const)(
  "moves %s work to Ready with pickup/service guidance",
  async (mode) => {
    setup();
    await screen.findByRole("article");
    let isReady = false;
    const preparing = {
      ...ticket(),
      mode,
      tableNumber: mode === "DINE_IN" ? "Patio 2" : null,
      preparationStatus: "PREPARING",
      preparationStartedAt: "2026-10-15T01:05:00.000Z",
      preparationStartedBy: "user-a",
    };
    const ready = {
      ...preparing,
      preparationStatus: "READY",
      preparationReadyAt: "2026-10-15T01:15:00.000Z",
      preparationReadyBy: "user-a",
    };
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        orders: String(url).endsWith("/preparing")
          ? isReady
            ? []
            : [preparing]
          : String(url).endsWith("/ready") && isReady
            ? [ready]
            : [],
        nextCursor: null,
      },
    }));
    await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
    const button = await screen.findByRole("button", {
      name: "Mark ready ORD-000001",
    });
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await userEvent.click(button);
    expect(button).toBeDisabled();
    isReady = true;
    await act(async () =>
      finish({ data: { order: ready, alreadyReady: false } }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("article")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Ready" }));
    const card = await screen.findByRole("article", {
      name: "Order ORD-000001",
    });
    expect(
      within(card).getByText(
        mode === "TAKEOUT" ? "Ready for pickup" : "Ready to serve",
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByText("READY · PREPARATION COMPLETE"),
    ).toBeInTheDocument();
    expect(
      card.querySelector('time[datetime="2026-10-15T01:15:00.000Z"]'),
    ).toBeInTheDocument();
    expect(
      within(card).queryByRole("button", {
        name: /Start preparing|Mark ready/,
      }),
    ).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith(
      "/shops/shop-a/orders/first/mark-ready",
      {},
      expect.any(Object),
    );
  },
);
it("keeps preparing work recoverable after a failed ready action", async () => {
  setup();
  await screen.findByRole("article");
  const preparing = {
    ...ticket(),
    preparationStatus: "PREPARING",
    preparationStartedAt: "2026-10-15T01:05:00.000Z",
    preparationStartedBy: "user-a",
  };
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [preparing], nextCursor: null },
  });
  await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Connection lost"));
  await userEvent.click(
    await screen.findByRole("button", { name: "Mark ready ORD-000001" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t confirm readiness",
  );
  expect(screen.getByRole("article")).toBeInTheDocument();
});
it("shows a meaningful empty Ready view", async () => {
  setup("KITCHEN", []);
  await screen.findByText("A little room to breathe.");
  await userEvent.click(screen.getByRole("button", { name: "Ready" }));
  expect(
    await screen.findByText("The finishing touches come next."),
  ).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it.each(["DINE_IN", "TAKEOUT"] as const)(
  "completes %s only after service/collection and shows the saved completion",
  async (mode) => {
    setup();
    await screen.findByRole("article");
    let fulfilled = false;
    const ready = {
      ...ticket(),
      mode,
      tableNumber: mode === "DINE_IN" ? "Patio 2" : null,
      preparationStatus: "READY",
      preparationStartedAt: "2026-10-15T01:05:00.000Z",
      preparationStartedBy: "user-a",
      preparationReadyAt: "2026-10-15T01:15:00.000Z",
      preparationReadyBy: "user-a",
    };
    const completed = {
      ...ready,
      preparationStatus: "COMPLETED",
      completedAt: "2026-10-15T01:20:00.000Z",
      completedBy: "user-a",
    };
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        orders: String(url).endsWith("/ready")
          ? fulfilled
            ? []
            : [ready]
          : String(url).endsWith("/completed") && fulfilled
            ? [completed]
            : [],
        nextCursor: null,
      },
    }));
    await userEvent.click(screen.getByRole("button", { name: "Ready" }));
    const button = await screen.findByRole("button", {
      name: "Mark completed ORD-000001",
    });
    expect(button).toHaveTextContent(
      mode === "TAKEOUT" ? "Mark collected" : "Mark served",
    );
    expect(
      screen.getByText(
        "Only complete after the customer has received this order.",
      ),
    ).toBeInTheDocument();
    let finish!: (value: unknown) => void;
    vi.mocked(api.post).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await userEvent.click(button);
    expect(button).toBeDisabled();
    fulfilled = true;
    await act(async () =>
      finish({ data: { order: completed, alreadyCompleted: false } }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("article")).not.toBeInTheDocument(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Completed" }));
    const card = await screen.findByRole("article");
    expect(
      within(card).getByText(
        mode === "TAKEOUT" ? "Collected by customer" : "Served to customer",
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText("COMPLETED · FULFILLED")).toBeInTheDocument();
    expect(
      card.querySelector('time[datetime="2026-10-15T01:20:00.000Z"]'),
    ).toBeInTheDocument();
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);
it("keeps Ready work recoverable when completion fails", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockResolvedValue({
    data: {
      orders: [
        {
          ...ticket(),
          preparationStatus: "READY",
          preparationStartedAt: "2026-10-15T01:05:00.000Z",
          preparationStartedBy: "user-a",
          preparationReadyAt: "2026-10-15T01:15:00.000Z",
          preparationReadyBy: "user-a",
        },
      ],
      nextCursor: null,
    },
  });
  await userEvent.click(screen.getByRole("button", { name: "Ready" }));
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Connection lost"));
  await userEvent.click(
    await screen.findByRole("button", { name: "Mark completed ORD-000001" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t confirm completion",
  );
  expect(screen.getByRole("article")).toBeInTheDocument();
});
it("keeps tickets with a visible warning after a failed refresh and recovers", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Connection lost"));
  await userEvent.click(screen.getByRole("button", { name: "Refresh orders" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "may be out of date",
  );
  expect(screen.getByRole("article")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});
it("hides cached tickets immediately when queue access is revoked", async () => {
  const client = setup();
  await screen.findByRole("article");
  const error = new AxiosError("Denied");
  error.response = { status: 403 } as NonNullable<typeof error.response>;
  vi.mocked(api.get).mockRejectedValue(error);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["kitchen", "queue"] });
  });
  expect(
    await screen.findByRole("heading", { name: "Kitchen access required" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it.each([
  { shopId: "foreign-shop" },
  { preparationStatus: "READY" },
  { preparationStatus: "PREPARING" },
  { queuedAt: "invalid" },
  { mode: "DINE_IN", tableNumber: null },
  { items: [] },
  { totalPrice: "1.00" },
])("rejects an invalid or foreign queue response: %j", async (change) => {
  setup("KITCHEN", [{ ...ticket(), ...change } as ReturnType<typeof ticket>]);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be verified",
  );
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
