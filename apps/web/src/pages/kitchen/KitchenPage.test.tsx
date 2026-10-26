import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { focusManager, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { feedback } from "../../app/stores/feedback";
import {
  subscribeNewOrders,
  subscribeOrderStream,
} from "../../features/orders/new-order-events";

vi.mock("../../features/orders/new-order-events", () => ({
  subscribeNewOrders: vi.fn(() => vi.fn()),
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));

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
const dialogMethods = ["showModal", "close"] as const;
const dialogDescriptors = dialogMethods.map((method) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
);
beforeEach(() => {
  for (const method of dialogMethods)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
});
afterEach(() => {
  cleanup();
  dialogMethods.forEach((method, index) => {
    const descriptor = dialogDescriptors[index];
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); focusManager.setFocused(undefined); onlineManager.setOnline(true); });
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
            <Route path="/app/shops/shop-a" element={<h1>Shop overview</h1>} />
          </Routes>
        </MemoryRouter>
      </ActiveShopContext.Provider>
    </QueryClientProvider>,
  );
  return client;
}
it("keeps the Preparing view and distance layout on tab return while refreshing queue data", async () => {
  focusManager.setFocused(true);
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockResolvedValue({ data: { orders: [{ ...ticket(), preparationStatus: "PREPARING", preparationStartedAt: "2026-10-15T01:05:00.000Z", preparationStartedBy: "user-a" }], nextCursor: null } });
  await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
  await screen.findByRole("button", { name: "Mark ready ORD-000001" });
  await userEvent.click(screen.getByRole("button", { name: "Distance view" }));
  const queueReads = vi.mocked(api.get).mock.calls.length;
  const accessReads = vi.mocked(getShopMembership).mock.calls.length;
  await act(async () => { focusManager.setFocused(false); onlineManager.setOnline(false); });
  await act(async () => { focusManager.setFocused(true); onlineManager.setOnline(true); });
  expect(screen.getByRole("button", { name: "Preparing" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Distance view" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Mark ready ORD-000001" })).toBeInTheDocument();
  expect(vi.mocked(getShopMembership).mock.calls.length).toBeGreaterThan(accessReads);
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(queueReads));
});

it("shows dine-in counter pickup on tickets and marks ready orders collected", async () => {
  setup("KITCHEN", [{ ...ticket(), serviceType: "COUNTER_PICKUP" }]);
  await screen.findByRole("article");
  expect(screen.getByText("Dine-in · Counter pickup")).toBeVisible();
  expect(screen.getByText("Table Patio 2")).toBeVisible();
  vi.mocked(api.get).mockResolvedValue({ data: { orders: [{
    ...ticket(), serviceType: "COUNTER_PICKUP", preparationStatus: "READY",
    preparationStartedAt: "2026-10-15T01:05:00.000Z", preparationStartedBy: "user-a",
    preparationReadyAt: "2026-10-15T01:15:00.000Z", preparationReadyBy: "user-a",
  }], nextCursor: null } });
  await userEvent.click(screen.getByRole("button", { name: "Ready" }));
  expect(await screen.findByText("Ready for pickup")).toBeVisible();
  expect(screen.getByRole("button", { name: "Mark completed ORD-000001" })).toHaveTextContent("Mark collected");
});
it.each(["ORD-000042", "ORD-1000000", "ORD-9223372036854775807"])(
  "displays the complete saved receipt/cashier reference %s on kitchen tickets",
  async (orderNumber) => {
    setup("KITCHEN", [ticket("first", orderNumber)]);
    expect(await screen.findByRole("heading", { name: orderNumber })).toBeVisible();
  },
);
it("switches distance presentation by keyboard while preserving FIFO, modifiers and notes without writes", async () => {
  setup("KITCHEN", [
    ticket("later", "ORD-000002", "2026-10-15T02:00:00.000Z"),
    ticket(),
  ]);
  await screen.findByRole("article", { name: "Order ORD-000001" });
  const toggle = screen.getByRole("button", { name: "Distance view" });
  const standard = screen.getByRole("button", { name: "Standard" });
  expect(screen.getByRole("group", { name: "Ticket display" })).toBeInTheDocument();
  expect(standard).toHaveAttribute("aria-pressed", "true");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  toggle.focus();
  await userEvent.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(standard).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText(/One ticket per row on phones/)).toBeInTheDocument();
  const orders = screen.getAllByRole("article");
  expect(orders[0]).toHaveAccessibleName("Order ORD-000001");
  expect(orders[1]).toHaveAccessibleName("Order ORD-000002");
  for (const order of orders) {
    for (const text of ["Table Patio 2", "Iced latte", "Large", "+ Oat milk", "No ice, please"])
      expect(within(order).getByText(text)).toBeVisible();
    expect(within(order).getByLabelText("Quantity 2")).toBeVisible();
  }
  expect(api.post).not.toHaveBeenCalled();
  await userEvent.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(toggle).toHaveFocus();
  await userEvent.click(standard);
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  expect(standard).toHaveAttribute("aria-pressed", "true");
  expect(standard).toHaveFocus();
});
it("refreshes queued orders when the shop's New Order subscription signals entry or reconnect", async () => {
  setup("KITCHEN");
  await screen.findByRole("article", { name: "Order ORD-000001" });
  const callback = vi.mocked(subscribeNewOrders).mock.calls[0][2];
  expect(
    screen.queryByText(
      /Live updates connecting|New orders update live|every 15 seconds/,
    ),
  ).not.toBeInTheDocument();
  expect(subscribeNewOrders).toHaveBeenCalledWith(
    "shop-a",
    "kitchen",
    expect.any(Function),
    expect.any(Function),
  );
  vi.mocked(api.get).mockResolvedValue({
    data: {
      orders: [ticket(), ticket("second", "ORD-000002")],
      nextCursor: null,
    },
  });
  act(() => callback(true));
  await screen.findByRole("article", { name: "Order ORD-000002" });
  act(() => callback(false));
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
});
it("removes a started order from the queue on a preparation event without manual refresh", async () => {
  setup("KITCHEN");
  await screen.findByRole("article", { name: "Order ORD-000001" });
  expect(subscribeOrderStream).toHaveBeenCalledWith(
    "/shops/shop-a/orders/preparation-events",
    { shopId: "shop-a" },
    ["order_preparing", "order_ready", "order_completed"],
    expect.any(Function),
    expect.any(Function),
    expect.any(Function),
    true,
  );
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [], nextCursor: null },
  });
  act(() =>
    vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_preparing", {
      shopId: "shop-a",
      orderId: "first",
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: "Order ORD-000001" }),
    ).not.toBeInTheDocument(),
  );
});
it.each(["KITCHEN", "OWNER", "ADMIN", "MANAGER"] as const)(
  "shows real preparation details for %s",
  async (role) => {
    setup(role);
    const order = await screen.findByRole("article", {
      name: "Order ORD-000001",
    });
    for (const text of [
      "Table Patio 2",
      "Dine-in · Table service",
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
    await screen.findByRole("heading", { name: "Shop overview" }),
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

it("adds the remotely started order to an open Preparing view without a local action", async () => {
  setup("KITCHEN", []);
  await screen.findByRole("button", { name: "Preparing" });
  await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
  await screen.findByText("Nothing preparing just yet.");
  const prepared = {
    ...ticket(),
    preparationStatus: "PREPARING",
    preparationStartedAt: "2026-10-15T01:05:00.000Z",
    preparationStartedBy: "remote-staff",
  };
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [prepared], nextCursor: null },
  });
  act(() =>
    vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_preparing", {
      shopId: "shop-a",
      orderId: "first",
    }),
  );
  const article = await screen.findByRole("article", {
    name: "Order ORD-000001",
  });
  expect(
    within(article).getByText("PREPARING · IN PROGRESS"),
  ).toBeInTheDocument();
  expect(
    article.querySelector('time[datetime="2026-10-15T01:05:00.000Z"]'),
  ).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
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
it("keeps a pending action locked when its ticket unmounts and remounts", async () => {
  setup();
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
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      orders: String(url).endsWith("/queue") ? [ticket()] : [],
      nextCursor: null,
    },
  }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Start preparing ORD-000001" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
  await screen.findByText("Nothing preparing just yet.");
  await userEvent.click(screen.getByRole("button", { name: "Queued" }));
  const remounted = await screen.findByRole("button", {
    name: "Start preparing ORD-000001",
  });
  try {
    expect(remounted).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);
  } finally {
    vi.mocked(api.get).mockResolvedValue({
      data: { orders: [], nextCursor: null },
    });
    await act(async () =>
      finish({ data: { order: prepared, alreadyStarted: false } }),
    );
  }
});
it("does not publish an old account action result into a replacement session", async () => {
  const client = setup();
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
  await userEvent.click(
    await screen.findByRole("button", { name: "Start preparing ORD-000001" }),
  );
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [], nextCursor: null },
  });
  await userEvent.click(screen.getByRole("button", { name: "Preparing" }));
  await screen.findByText("Nothing preparing just yet.");
  client.setQueryData(["auth", "me"], { user: { id: "user-b" } });
  const toast = vi.spyOn(feedback, "toast");
  try {
    await act(async () =>
      finish({ data: { order: prepared, alreadyStarted: false } }),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(toast).not.toHaveBeenCalled();
  } finally {
    toast.mockRestore();
  }
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
it.each(["Preparing", "Ready"])(
  "refreshes an open %s view when another staff member marks an order ready",
  async (view) => {
    setup("KITCHEN", []);
    await screen.findByRole("button", { name: view });
    const preparing = {
      ...ticket(),
      preparationStatus: "PREPARING",
      preparationStartedAt: "2026-10-15T01:05:00.000Z",
      preparationStartedBy: "user-a",
    };
    const ready = {
      ...preparing,
      preparationStatus: "READY",
      preparationReadyAt: "2026-10-15T01:15:00.000Z",
      preparationReadyBy: "remote-staff",
    };
    let isReady = false;
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        orders: String(url).endsWith("/preparing")
          ? isReady
            ? []
            : [preparing]
          : String(url).endsWith("/ready")
            ? isReady
              ? [ready]
              : []
            : [],
        nextCursor: null,
      },
    }));
    await userEvent.click(screen.getByRole("button", { name: view }));
    if (view === "Preparing")
      await screen.findByRole("article", { name: "Order ORD-000001" });
    else await screen.findByText("The finishing touches come next.");
    isReady = true;
    act(() =>
      vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_ready", {
        shopId: "shop-a",
        orderId: "first",
      }),
    );
    if (view === "Preparing")
      await waitFor(() =>
        expect(screen.queryByRole("article")).not.toBeInTheDocument(),
      );
    else {
      const card = await screen.findByRole("article", {
        name: "Order ORD-000001",
      });
      expect(
        card.querySelector('time[datetime="2026-10-15T01:15:00.000Z"]'),
      ).toBeInTheDocument();
      expect(screen.getAllByRole("article")).toHaveLength(1);
    }
    expect(api.post).not.toHaveBeenCalled();
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
    await userEvent.click(
      await screen.findByRole("button", {
        name: "View details for ORD-000001",
      }),
    );
    const card = within(screen.getByRole("dialog")).getByRole("article");
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

const historyTicket = (
  id = "done-1",
  number = "ORD-000042",
): PreparationQueueResponse["orders"][number] => ({
  ...ticket(id, number),
  preparationStatus: "COMPLETED",
  preparationStartedAt: "2026-10-15T01:01:00.000Z",
  preparationStartedBy: "staff",
  preparationReadyAt: "2026-10-15T01:10:00.000Z",
  preparationReadyBy: "staff",
  completedAt: "2026-10-15T01:20:00.000Z",
  completedBy: "staff",
});
const numberedHistory = (page = 1): PreparationQueueResponse => ({
  orders: page === 2 ? [historyTicket("done-2", "ORD-000041")] : [
    historyTicket(), ...Array.from({ length: 11 }, (_, index) => historyTicket(`extra-${index}`, `ORD-${String(100 + index).padStart(6, "0")}`)),
  ],
  nextCursor: null,
  pagination: { page, pageSize: 12, pageCount: 2, total: 13, snapshot: "2026-10-16T00:00:00.000Z", hasNew: false },
});
it("replaces completed pages rather than appending and can return to the first page", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({
    data: numberedHistory((config?.params as { page?: number } | undefined)?.page ?? 1),
  }));
  await userEvent.click(screen.getByRole("button", { name: "Completed" }));
  await screen.findByText("ORD-000042");
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("ORD-000041");
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  expect(api.get).toHaveBeenLastCalledWith(
    "/shops/shop-a/preparation/completed",
    expect.objectContaining({ params: { limit: 12, page: 2, snapshot: "2026-10-16T00:00:00.000Z" } }),
  );
  const reads = vi.mocked(api.get).mock.calls.length;
  act(() =>
    vi
      .mocked(subscribeOrderStream)
      .mock.calls[0][4]("order_completed", {
        shopId: "shop-a",
        orderId: "remote-completed",
      }),
  );
  await waitFor(() =>
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(reads),
  );
  expect(api.get).toHaveBeenLastCalledWith(
    "/shops/shop-a/preparation/completed",
    expect.objectContaining({ params: { limit: 12, page: 2, snapshot: "2026-10-16T00:00:00.000Z" } }),
  );
  expect(screen.getByText("ORD-000041")).toBeInTheDocument();
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("ORD-000042");
});
it("searches the whole completed history and resets pagination and filters", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockImplementation(async (_url, config) => ({ data: numberedHistory((config?.params as { page?: number } | undefined)?.page ?? 1) }));
  await userEvent.click(screen.getByRole("button", { name: "Completed" }));
  await screen.findByText("ORD-000042");
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText(/Page 2/);
  await userEvent.type(screen.getByLabelText("Order number"), "000099");
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-10-14" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-10-15" },
  });
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [], nextCursor: null },
  });
  await userEvent.click(screen.getByRole("button", { name: "Find orders" }));
  await screen.findByText("No matching orders.");
  const from = new Date("2026-10-14T00:00:00").toISOString();
  const to = new Date("2026-10-16T00:00:00").toISOString();
  expect(api.get).toHaveBeenLastCalledWith(
    "/shops/shop-a/preparation/completed",
    expect.objectContaining({
      params: { limit: 12, page: 1, search: "000099", from, to },
    }),
  );
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(
      "/shops/shop-a/preparation/completed",
      expect.objectContaining({ params: { limit: 12, page: 1 } }),
    ),
  );
  expect(screen.getByLabelText("Order number")).toHaveValue("");
});
it("keeps invalid date ranges local and preserves all ticket details in a dismissible modal", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [historyTicket()], nextCursor: null },
  });
  await userEvent.click(screen.getByRole("button", { name: "Completed" }));
  const trigger = await screen.findByRole("button", {
    name: "View details for ORD-000042",
  });
  await userEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Details for ORD-000042" });
  for (const text of ["No ice, please", "Large", "+ Oat milk"])
    expect(within(dialog).getByText(text)).toBeInTheDocument();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Close details" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-10-16" },
  });
  fireEvent.change(screen.getByLabelText("To"), {
    target: { value: "2026-10-15" },
  });
  const calls = vi.mocked(api.get).mock.calls.length;
  await userEvent.click(screen.getByRole("button", { name: "Find orders" }));
  expect(
    screen.getByText("The end date must be on or after the start date."),
  ).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledTimes(calls);
});

it("allows returning to a previous history page after the next request fails", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockResolvedValue({
    data: numberedHistory(),
  });
  await userEvent.click(screen.getByRole("button", { name: "Completed" }));
  await screen.findByText("ORD-000042");
  vi.mocked(api.get).mockRejectedValueOnce(new AxiosError("private network diagnostic", "ERR_NETWORK"));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText(/Connection interrupted/);
  await userEvent.click(screen.getByRole("button", { name: "Previous" }));
  await screen.findByText("ORD-000042");
});
it("keeps applied history filters visible when switching preparation views", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockResolvedValue({
    data: { orders: [], nextCursor: null },
  });
  await userEvent.click(screen.getByRole("button", { name: "Completed" }));
  await userEvent.type(screen.getByLabelText("Order number"), "000042");
  await userEvent.click(screen.getByRole("button", { name: "Find orders" }));
  await screen.findByText("No matching orders.");
  await userEvent.click(screen.getByRole("button", { name: "Queued" }));
  await userEvent.click(screen.getByRole("button", { name: "Completed" }));
  expect(screen.getByLabelText("Order number")).toHaveValue("000042");
  await waitFor(() =>
    expect(api.get).toHaveBeenLastCalledWith(
      "/shops/shop-a/preparation/completed",
      expect.objectContaining({ params: { limit: 12, page: 1, search: "000042" } }),
    ),
  );
});

it.each(["Ready", "Completed"])(
  "refreshes the open %s view on remote completion without duplicate cards or writes",
  async (view) => {
    setup("KITCHEN", []);
    await screen.findByRole("button", { name: view });
    const completed = historyTicket();
    const ready = {
      ...completed,
      preparationStatus: "READY",
      completedAt: null,
      completedBy: null,
    };
    let done = false;
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        orders: String(url).endsWith("/ready")
          ? done
            ? []
            : [ready]
          : String(url).endsWith("/completed")
            ? done
              ? [completed]
              : []
            : [],
        nextCursor: null,
      },
    }));
    await userEvent.click(screen.getByRole("button", { name: view }));
    if (view === "Ready") await screen.findByRole("article");
    else
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith(
          "/shops/shop-a/preparation/completed",
          expect.any(Object),
        ),
      );
    done = true;
    act(() => {
      for (let i = 0; i < 3; i++)
        vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_completed", {
          shopId: "shop-a",
          orderId: completed.id,
        });
    });
    if (view === "Ready")
      await waitFor(() =>
        expect(screen.queryByRole("article")).not.toBeInTheDocument(),
      );
    else {
      await screen.findByText(completed.orderNumber);
      expect(screen.getAllByText(completed.orderNumber)).toHaveLength(1);
      expect(screen.queryByRole("article")).not.toBeInTheDocument();
    }
    expect(api.post).not.toHaveBeenCalled();
  },
);
