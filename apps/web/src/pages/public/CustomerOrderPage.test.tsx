import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomerOrderResponse } from "@paserve/contracts";
import { CustomerOrderPage } from "./CustomerOrderPage";
import { PublicMenuPage } from "./PublicMenuPage";
import {
  orderReceipts,
  saveOrderReceipt,
  readOrderReceipt,
} from "../../features/cart/order-receipt";
import { pendingOrders } from "../../features/cart/pending-orders";
import { useCart } from "../../features/cart/cart";
import { useCustomerTables } from "../../features/shops/customer-table";
import { api } from "../../lib/api/client";
import { feedback } from "../../app/stores/feedback";
import { clearCustomerOrderQrs } from "../../features/cart/customer-order-qr";
import { subscribeOrderStream } from "../../features/orders/new-order-events";
import { cashierLine } from "../../test/cashier-fixtures";

vi.mock("../../features/orders/new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));

vi.mock("../../lib/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
const table = {
  shopSlug: "cafe",
  code: "T12",
  number: "Patio 4",
  checkoutToken: `context.${"a".repeat(43)}`,
};
const quote = {
  productId: "coffee",
  productName: "Coffee",
  currency: "PHP" as const,
  basePrice: "10.00",
  unitPrice: "10.00",
  totalPrice: "10.00",
  quantity: 1,
  variants: [],
  addOns: [],
};
const order: CustomerOrderResponse["order"] = {
  id: "order-a",
  orderNumber: "ORD-000042",
  mode: "TAKEOUT",
  table: null,
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  currency: "PHP",
  totalPrice: "12.00",
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:00:00Z",
  qrToken: `cGF5bG9hZA.${"a".repeat(43)}`,
  qrTokenExpiresAt: "2026-10-19T00:00:00Z",
  items: [
    { ...quote, basePrice: "12.00", unitPrice: "12.00", totalPrice: "12.00" },
  ],
};
const show = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const close = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  orderReceipts.clearMemory();
  clearCustomerOrderQrs();
  pendingOrders.clearMemory();
  useCart.setState({ shops: {} });
  useCustomerTables.setState({ codes: {}, resolved: {} });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  if (show)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", show);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
function setup(path = "/menu/cafe/orders/order-a") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/menu/:shopSlug/orders/:orderId"
            element={<CustomerOrderPage />}
          />
          <Route path="/menu/:shopSlug" element={<PublicMenuPage />} />
          <Route
            path="/:shopSlug/table/:tableCode"
            element={<PublicMenuPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it.each(["DINE_IN", "TAKEOUT"] as const)(
  "keeps every saved %s receipt line and its options after refresh without menu repricing",
  (mode) => {
    const line = { ...cashierLine, variants: cashierLine.variants.map((option) => ({ ...option })) };
    const plainLine = { ...cashierLine, variants: [], addOns: [], notes: undefined, unitPrice: "50.00", totalPrice: "100.00" };
    const savedOrder: CustomerOrderResponse["order"] = mode === "DINE_IN"
      ? { ...order, mode, table, items: [line, plainLine], totalPrice: "235.50" }
      : { ...order, mode, table: null, items: [line, plainLine], totalPrice: "235.50" };
    saveOrderReceipt("cafe", "Cafe", savedOrder);
    line.productName = "Renamed menu item";
    line.variants[0].name = "Renamed variant";
    const view = setup();
    expect(screen.getAllByRole("heading", { name: "2 × Saved Latte" })).toHaveLength(2);
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(screen.getByText("Oat milk")).toBeInTheDocument();
    expect(screen.getByText("Line total: ₱135.50")).toBeInTheDocument();
    expect(screen.getByText("Line total: ₱100.00")).toBeInTheDocument();
    view.unmount();
    orderReceipts.clearMemory();
    setup();
    expect(screen.getAllByRole("heading", { name: "2 × Saved Latte" })).toHaveLength(2);
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(screen.queryByText("Renamed menu item")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  },
);

it("shows the saved shop identity in the customer receipt after refresh", () => {
  saveOrderReceipt("cafe", "Current menu name", { ...order, shopDetails: {
    name: "Original Cafe", address: "12 Old Street", phone: "09171234567",
    contactEmail: "hello@example.com", website: "https://example.com",
  } });
  orderReceipts.clearMemory();
  setup();
  expect(screen.getByRole("region", { name: "Shop details" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Original Cafe" })).toBeInTheDocument();
  expect(screen.getByText("12 Old Street")).toBeInTheDocument();
  expect(screen.queryByText("Current menu name")).not.toBeInTheDocument();
});

it("opens a private tracking link on another device and reopens from the guest cookie without a saved receipt or cashier QR", async () => {
  const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828";
  const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
  const trackingToken = `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-tracking", shopId, orderId, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: Date.parse("2030-01-01T00:00:00Z") })).toString("base64url")}.${"a".repeat(43)}`;
  const saved = {
    order: {
      id: orderId, shopId, orderNumber: "ORD-000042", status: "CONFIRMED", paymentStatus: "PAID",
      confirmedAt: "2026-10-15T01:01:00Z", preparationStatus: "QUEUED", updatedAt: "2026-10-15T01:01:00Z",
    },
    trackingExpiresAt: "2030-01-01T00:00:00Z",
    receipt: {
      shopSlug: "cafe", shopName: "Cafe", primaryColor: null, accentColor: null,
      id: orderId, orderNumber: "ORD-000042", mode: "TAKEOUT", table: null,
      status: "PENDING_CONFIRMATION", currency: "PHP", totalPrice: "12.00",
      items: order.items,
    },
  };
  const fetchStatus = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => saved });
  vi.stubGlobal("fetch", fetchStatus);
  const path = `/menu/cafe/orders/${orderId}`;
  window.history.replaceState({}, "", `${path}#tracking=${trackingToken}`);
  const view = setup(path);
  await screen.findByRole("heading", { name: "Order confirmed" });
  expect(screen.getByRole("heading", { name: "1 × Coffee" })).toBeInTheDocument();
  expect(screen.getByText("Order number: ORD-000042")).toBeVisible();
  expect(window.location.hash).toBe("");
  expect(fetchStatus.mock.calls[0][0]).toBe(`${path}/tracking-session`);
  expect(fetchStatus.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include", headers: { Authorization: `Bearer ${trackingToken}` } });
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Order QR for ORD-000042" })).not.toBeInTheDocument();
  expect(localStorage.getItem("paserve-active-orders:v1:cafe")).not.toContain(trackingToken);
  expect(sessionStorage.getItem(`paserve-order-receipt:v1:cafe:${orderId}`)).not.toContain(trackingToken);
  view.unmount();
  orderReceipts.clearMemory();
  clearCustomerOrderQrs();
  sessionStorage.clear();
  fetchStatus.mockClear();
  setup(path);
  await screen.findByRole("heading", { name: "Order confirmed" });
  expect(fetchStatus.mock.calls[0][0]).toBe(`${path}/status`);
  expect(fetchStatus.mock.calls[0][1]).toMatchObject({ credentials: "include", headers: {} });
  expect(screen.getByText("₱12.00")).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});

it.each(["TAKEOUT", "DINE_IN"] as const)("updates a pending %s receipt to confirmed, queued and later stages without manual refresh", async (mode) => {
  const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828",
    shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
  const expiresAt = Date.parse("2030-01-01T00:00:00Z");
  const token = `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-receipt", shopId, orderId, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: expiresAt })).toString("base64url")}.${"a".repeat(43)}`;
  const saved: CustomerOrderResponse["order"] =
    mode === "DINE_IN" ? { ...order, mode, table } : order;
  saveOrderReceipt("cafe", "Cafe", {
    ...saved,
    id: orderId,
    qrToken: token,
    qrTokenExpiresAt: new Date(expiresAt).toISOString(),
  });
  const pending = {
    id: orderId,
    shopId,
    orderNumber: order.orderNumber,
    status: "PENDING_CONFIRMATION",
    paymentStatus: "UNPAID",
    confirmedAt: null,
    updatedAt: "2026-10-15T01:00:00Z",
  };
  const fetchStatus = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ order: pending }),
  });
  vi.stubGlobal("fetch", fetchStatus);
  setup(`/menu/cafe/orders/${orderId}`);
  await waitFor(() => expect(fetchStatus).toHaveBeenCalledOnce());
  expect(
    screen.getByRole("heading", { name: "Waiting for Confirmation" }),
  ).toBeInTheDocument();
  fetchStatus.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      order: {
        ...pending,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        confirmedAt: "2026-10-15T01:01:00Z",
        preparationStatus: "QUEUED",
        updatedAt: "2026-10-15T01:01:00Z",
      },
    }),
  });
  act(() =>
    vi
      .mocked(subscribeOrderStream)
      .mock.calls[0][4]("order_confirmed", { shopId, orderId }),
  );
  await screen.findByRole("heading", { name: "Order confirmed" });
  expect(screen.getByText("Confirmed and paid.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Confirmed. The counter accepted your order and confirmed your payment. The kitchen will start preparing it next.",
  );
  expect(screen.getByText("Confirmed")).toBeInTheDocument();
  expect(screen.getByText("Payment confirmed by the cashier.")).toBeInTheDocument();
  expect(screen.getByText("Confirmed and paid.").closest("li")).toHaveClass("is-complete");
  const queueStep = screen.getByText("Waiting for preparation to start.").closest("li");
  expect(queueStep).toHaveAttribute("aria-current", "step");
  expect(queueStep).not.toHaveClass("is-complete");
  expect(screen.queryByText("Preparing")).not.toBeInTheDocument();
  expect(screen.queryByText("Preparation in progress.")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Waiting for Confirmation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Your order is not yet in the kitchen queue/),
  ).not.toBeInTheDocument();
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(fetchStatus.mock.lastCall?.[1].headers.Authorization).toBeUndefined();
  expect(fetchStatus.mock.lastCall?.[1].credentials).toBe("include");
  // Repeated delivery must replace/refetch the same saved status, never append
  // another receipt, progress step, notification, or state-changing request.
  const callsBeforeDuplicates = fetchStatus.mock.calls.length;
  act(() => {
    for (let i = 0; i < 3; i++)
      vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_confirmed", {
        shopId,
        orderId,
      });
  });
  await waitFor(() =>
    expect(fetchStatus.mock.calls.length).toBeGreaterThan(
      callsBeforeDuplicates,
    ),
  );
  expect(
    screen.getAllByRole("heading", { name: "Order confirmed" }),
  ).toHaveLength(1);
  expect(screen.getAllByText("Confirmed and paid.")).toHaveLength(1);
  expect(screen.getAllByText("ORD-000042")).toHaveLength(1);
  expect(screen.getAllByRole("list", { name: "Order progress" })).toHaveLength(
    1,
  );
  expect(api.post).not.toHaveBeenCalled();
  fetchStatus.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      order: {
        ...pending,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        confirmedAt: "2026-10-15T01:01:00Z",
        preparationStatus: "PREPARING",
        preparationStartedAt: "2026-10-15T01:02:00Z",
        updatedAt: "2026-10-15T01:02:00Z",
      },
    }),
  });
  act(() =>
    vi
      .mocked(subscribeOrderStream)
      .mock.calls[0][4]("order_preparing", { shopId, orderId }),
  );
  await screen.findByRole("heading", { name: "Order in preparation" });
  expect(screen.queryByText("Waiting for preparation to start.")).not.toBeInTheDocument();
  expect(screen.getByText("Preparing")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Preparing. The kitchen is actively preparing your order.",
  );
  expect(screen.getByText("In the kitchen")).toBeInTheDocument();
  expect(screen.getByText(
    "Preparation times vary. Watch this page for the Ready status.",
  )).toBeInTheDocument();
  const activePreparation = screen.getByText("Preparation in progress.").closest("li");
  expect(activePreparation).toHaveAttribute("aria-current", "step");
  expect(activePreparation).not.toHaveClass("is-complete");
  expect(screen.queryByRole("heading", { name: "Order ready" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Please collect it at the counter/)).not.toBeInTheDocument();
  fetchStatus.mockResolvedValueOnce({ ok: false, status: 500 });
  act(() => vi.mocked(subscribeOrderStream).mock.calls[0][4]("resync", { shopId, orderId }));
  await screen.findByRole("note");
  expect(screen.getByRole("note")).toHaveTextContent("The status shown may be out of date.");
  expect(screen.getByText("Preparing")).toBeInTheDocument();
  act(() => {
    for (let i = 0; i < 3; i++)
      vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_preparing", {
        shopId,
        orderId,
      });
  });
  await waitFor(() =>
    expect(
      screen.getAllByRole("heading", { name: "Order in preparation" }),
    ).toHaveLength(1),
  );
  await waitFor(() => expect(screen.queryByRole("note")).not.toBeInTheDocument());
  fetchStatus.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      order: {
        ...pending,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        confirmedAt: "2026-10-15T01:01:00Z",
        preparationStatus: "READY",
        preparationStartedAt: "2026-10-15T01:02:00Z",
        preparationReadyAt: "2026-10-15T01:03:00Z",
        updatedAt: "2026-10-15T01:03:00Z",
      },
    }),
  });
  act(() =>
    vi
      .mocked(subscribeOrderStream)
      .mock.calls[0][4]("order_ready", { shopId, orderId }),
  );
  await screen.findByRole("heading", { name: "Order ready" });
  expect(screen.getByText("Ready")).toBeInTheDocument();
  expect(screen.getByRole("heading", {
    name: mode === "DINE_IN" ? "Ready for table service" : "Collect your order at the counter",
  })).toBeInTheDocument();
  expect(screen.getByText(mode === "DINE_IN"
    ? "Please stay at Table Patio 4 for service."
    : "Have your order number ready when collecting your order.",
  )).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveAttribute("aria-atomic", "true");
  expect(screen.getByRole("status")).toHaveTextContent(mode === "DINE_IN"
    ? "Ready. Your order is ready for table service."
    : "Ready. Your order is ready for pickup. Please collect it at the counter.",
  );
  expect(screen.queryByText("Completed")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "View receipt" })).not.toBeInTheDocument();
  expect(
    screen.getAllByText(
      mode === "DINE_IN"
        ? "Your order is ready for table service."
        : "Your order is ready for pickup. Please collect it at the counter.",
    ),
  ).toHaveLength(2);
  expect(screen.queryByText("Preparing")).not.toBeInTheDocument();
  expect(screen.queryByText("Preparation in progress.")).not.toBeInTheDocument();
  expect(screen.queryByText(
    "Preparation times vary. Watch this page for the Ready status.",
  )).not.toBeInTheDocument();
  expect(screen.getAllByText("ORD-000042")).toHaveLength(1);
  expect(api.post).not.toHaveBeenCalled();
  fetchStatus.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      order: {
        ...pending,
        status: "CONFIRMED",
        paymentStatus: "PAID",
        confirmedAt: "2026-10-15T01:01:00Z",
        preparationStatus: "COMPLETED",
        preparationStartedAt: "2026-10-15T01:02:00Z",
        preparationReadyAt: "2026-10-15T01:03:00Z",
        completedAt: "2026-10-15T01:04:00Z",
        updatedAt: "2026-10-15T01:04:00Z",
      },
    }),
  });
  act(() => {
    for (let i = 0; i < 3; i++)
      vi.mocked(subscribeOrderStream).mock.calls[0][4]("order_completed", {
        shopId,
        orderId,
      });
  });
  await screen.findByRole("heading", { name: "Order completed" });
  expect(
    screen.getAllByRole("heading", { name: "Order completed" }),
  ).toHaveLength(1);
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent(mode === "DINE_IN"
    ? "Completed. Your order has been served. Thank you!"
    : "Completed. Your order has been collected. Thank you!",
  );
  const viewReceipt = screen.getByRole("link", { name: "View receipt" });
  expect(viewReceipt).toHaveAttribute("href", "#order-receipt-details");
  const readsBeforeReceipt = fetchStatus.mock.calls.length;
  await userEvent.click(viewReceipt);
  const receiptRegion = screen.getByRole("region", { name: "Order receipt" });
  expect(receiptRegion).toHaveFocus();
  expect(receiptRegion).toHaveTextContent("ORD-000042");
  expect(receiptRegion).toHaveTextContent("₱12.00");
  expect(receiptRegion).toHaveTextContent("Payment confirmed by the cashier.");
  expect(fetchStatus).toHaveBeenCalledTimes(readsBeforeReceipt);
  for (const [url, options] of fetchStatus.mock.calls) {
    expect(options.method ?? "GET").toBe("GET");
    expect(String(url)).not.toContain(token);
  }
  for (const link of screen.getAllByRole("link")) {
    expect(link.getAttribute("href")).not.toContain(token);
  }
  expect(screen.queryByRole("heading", {
    name: mode === "DINE_IN" ? "Ready for table service" : "Collect your order at the counter",
  })).not.toBeInTheDocument();
  expect(
    screen.getByText("Keep this receipt for your records."),
  ).toBeInTheDocument();
  expect(
    document.querySelector('time[datetime="2026-10-15T01:04:00Z"]'),
  ).toBeInTheDocument();
  expect(
    document.querySelector('[aria-current="step"]'),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(/Please collect it at the counter/),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("ORD-000042")).toHaveLength(1);
  expect(api.post).not.toHaveBeenCalled();
});

it("keeps the QR and order number after memory loss and a full reload", async () => {
  const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828";
  const expiry = Date.parse("2030-01-01T00:00:00Z");
  const qrToken = `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-receipt", shopId: "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e", orderId, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: expiry })).toString("base64url")}.${"a".repeat(43)}`;
  saveOrderReceipt("cafe", "Cafe", {
    ...order,
    id: orderId,
    qrToken,
    qrTokenExpiresAt: new Date(expiry).toISOString(),
  });
  const path = `/menu/cafe/orders/${orderId}`;
  const view = setup(path);
  const image = await screen.findByRole("img", {
    name: "Order QR for ORD-000042",
  });
  const number = screen.getByText("ORD-000042");
  expect(
    image.compareDocumentPosition(number) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(image).toHaveAttribute(
    "src",
    expect.stringContaining("data:image/svg+xml"),
  );
  expect(screen.queryByText(qrToken)).not.toBeInTheDocument();
  expect(
    sessionStorage.getItem(`paserve-order-receipt:v1:cafe:${orderId}`),
  ).not.toContain(qrToken);
  view.unmount();
  clearCustomerOrderQrs();
  orderReceipts.clearMemory();
  setup(path);
  expect(screen.getByText("Order number: ORD-000042")).toBeVisible();
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(
    await screen.findByRole("img", { name: "Order QR for ORD-000042" }),
  ).toHaveAttribute("src", image.getAttribute("src"));
  expect(
    screen.queryByText(/unavailable in this session/),
  ).not.toBeInTheDocument();
});

it.each(["TAKEOUT", "DINE_IN"] as const)(
  "navigates from %s checkout to the saved receipt and recovers it after refresh",
  async (mode) => {
    const saved: CustomerOrderResponse["order"] =
      mode === "DINE_IN" ? { ...order, mode, table } : order;
    vi.mocked(api.get).mockResolvedValue({
      data: {
        shop: {
          slug: "cafe",
          name: "Cafe",
          description: null,
          primaryColor: "#6A426C",
          accentColor: "#FAFF00",
        },
        categories: [],
        products: [],
        featuredProducts: [],
        ...(mode === "DINE_IN" ? { table } : {}),
      },
    });
    vi.mocked(api.post).mockResolvedValue({ data: { order: saved } });
    useCart.getState().add("cafe", quote);
    const view = setup(mode === "DINE_IN" ? "/cafe/table/T12" : "/menu/cafe");
    await screen.findByRole("heading", { name: "Cafe" });
    await userEvent.click(
      screen.getByRole("button", { name: "View cart (1)" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Review order" }));
    await userEvent.click(
      screen.getByRole("button", {
        name: mode === "DINE_IN" ? "Place dine-in order" : "Place pickup order",
      }),
    );
    const title = await screen.findByRole("heading", {
      name: "Waiting for Confirmation",
    });
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByText("ORD-000042")).toBeInTheDocument();
    expect(screen.getByText("₱12.00")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Confirmation");
    expect(
      screen.getByText(
        "Your order has been saved. Cashier verification and payment are still required.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Payment has not been confirmed by the cashier."),
    ).toBeInTheDocument();
    expect(document.querySelector('[aria-current="step"]')).toHaveTextContent(
      "Cashier verification & payment",
    );
    expect(document.querySelector('[aria-current="step"]')).not.toHaveClass(
      "is-complete",
    );
    expect(screen.getByText("Not queued yet.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your order is not yet in the kitchen queue.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "The cashier must confirm your order and payment before the kitchen starts preparing it.",
    );
    expect(
      screen.getByRole("heading", {
        name: "Show your order QR at the counter",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to menu" })).toHaveAttribute(
      "href",
      mode === "DINE_IN" ? "/cafe/table/T12" : "/menu/cafe",
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useCart.getState().shops.cafe).toEqual([]);
    expect(sessionStorage.getItem("paserve-pending-order:v1:cafe")).toBeNull();
    const snapshot = sessionStorage.getItem(
      "paserve-order-receipt:v1:cafe:order-a",
    )!;
    expect(snapshot).not.toContain(saved.qrToken);
    expect(snapshot).not.toContain(table.checkoutToken);
    expect(JSON.parse(snapshot).totalPrice).toBe(saved.totalPrice);
    expect(screen.getByRole("main")).toHaveStyle(
      "--menu-primary: #6A426C; --menu-accent: #FAFF00",
    );
    // New purchases after submission must not replace the saved order total.
    useCart.getState().add("cafe", {
      ...quote,
      basePrice: "99.00",
      unitPrice: "99.00",
      totalPrice: "99.00",
    });
    view.unmount();
    orderReceipts.clearMemory();
    setup();
    expect(screen.getByRole("main")).toHaveStyle(
      "--menu-primary: #6A426C; --menu-accent: #FAFF00",
    );
    expect(screen.getByText("ORD-000042")).toBeInTheDocument();
    expect(screen.getByText("₱12.00")).toBeInTheDocument();
    expect(screen.queryByText("₱99.00")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Waiting for Confirmation");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your order is not yet in the kitchen queue.",
    );
    expect(screen.getByText("₱12.00")).toHaveAccessibleDescription(
      "This is the total saved for your submitted order.",
    );
    expect(api.post).toHaveBeenCalledTimes(1);
  },
);

it("retains the receipt during navigation when browser storage is blocked", () => {
  const blocked = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  try {
    saveOrderReceipt("cafe", "Cafe", order);
    setup();
    expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  } finally {
    blocked.mockRestore();
  }
});

it.each([{ totalPrice: "1.00" }, { id: ".." }])(
  "keeps checkout open and preserves the cart for an invalid response: %j",
  async (invalid) => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        shop: { slug: "cafe", name: "Cafe", description: null },
        categories: [],
        products: [],
        featuredProducts: [],
      },
    });
    vi.mocked(api.post).mockResolvedValue({
      data: { order: { ...order, ...invalid } },
    });
    useCart.getState().add("cafe", quote);
    setup("/menu/cafe");
    await screen.findByRole("heading", { name: "Cafe" });
    await userEvent.click(
      screen.getByRole("button", { name: "View cart (1)" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Review order" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Place pickup order" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not been confirmed",
    );
    expect(
      screen.queryByRole("heading", { name: "Waiting for Confirmation" }),
    ).not.toBeInTheDocument();
    expect(useCart.getState().shops.cafe).toHaveLength(1);
    expect(
      sessionStorage.getItem("paserve-order-receipt:v1:cafe:order-a"),
    ).toBeNull();
  },
);
it("restores only display data from storage containing credentials and notes", () => {
  saveOrderReceipt("cafe", "Cafe", { ...order, mode: "DINE_IN", table });
  const key = "paserve-order-receipt:v1:cafe:order-a";
  const raw = JSON.parse(sessionStorage.getItem(key)!);
  Object.assign(raw, { qrToken: "private-order-token", notes: "private note" });
  raw.table.checkoutToken = "private-table-token";
  sessionStorage.setItem(key, JSON.stringify(raw));
  orderReceipts.clearMemory();
  const restored = readOrderReceipt("cafe", "order-a");
  expect(restored).not.toBeNull();
  expect(restored).not.toHaveProperty("qrToken");
  expect(restored).not.toHaveProperty("notes");
  expect(restored!.table).toEqual({ code: "T12", number: "Patio 4" });
});
it.each([
  { status: "CONFIRMED" },
  { status: "QUEUED" },
  { id: "other-order" },
  { orderNumber: "ORD-9999999999999999999" },
  { totalPrice: 12 },
  { currency: "USD" },
])(
  "does not claim a waiting receipt from corrupted display fields: %j",
  (invalid) => {
    saveOrderReceipt("cafe", "Cafe", order);
    const key = "paserve-order-receipt:v1:cafe:order-a";
    const raw = JSON.parse(sessionStorage.getItem(key)!);
    sessionStorage.setItem(key, JSON.stringify({ ...raw, ...invalid }));
    orderReceipts.clearMemory();
    setup();
    expect(
      screen.getByRole("heading", { name: "Order receipt unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  },
);

it.each([
  null,
  "{broken",
  JSON.stringify({ shopSlug: "other", id: "order-a" }),
])(
  "handles unavailable or invalid saved receipts without submitting again: %s",
  (saved) => {
    if (saved !== null)
      sessionStorage.setItem("paserve-order-receipt:v1:cafe:order-a", saved);
    setup();
    expect(
      screen.getByRole("heading", { name: "Order receipt unavailable" }),
    ).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "check it using your order number before placing another",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.post).not.toHaveBeenCalled();
  },
);

it("does not expose another shop's receipt", () => {
  saveOrderReceipt("cafe", "Cafe", order);
  setup("/menu/other/orders/order-a");
  expect(
    screen.getByRole("heading", { name: "Order receipt unavailable" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
});

it("retains an older saved receipt after the persisted status rename", () => {
  saveOrderReceipt("cafe", "Cafe", order);
  const key = "paserve-order-receipt:v1:cafe:order-a";
  const legacy = JSON.parse(sessionStorage.getItem(key)!);
  legacy.status = "PENDING";
  sessionStorage.setItem(key, JSON.stringify(legacy));
  orderReceipts.clearMemory();
  setup();
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for Confirmation");
});

it.each(["invalid", "-1.00", "12.345", "12.00\n"])(
  "does not substitute cart estimates when the saved total is invalid: %s",
  (totalPrice) => {
    useCart.getState().add("cafe", quote);
    saveOrderReceipt("cafe", "Cafe", { ...order, totalPrice });
    setup();
    expect(
      screen.getByRole("heading", { name: "Order receipt unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("₱10.00")).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  },
);
it.each(["invalid", "T12\n", "../other"])(
  "does not restore an invalid dine-in table code: %j",
  (code) => {
    saveOrderReceipt("cafe", "Cafe", {
      ...order,
      mode: "DINE_IN",
      table: { ...table, code },
    });
    setup();
    expect(
      screen.getByRole("heading", { name: "Order receipt unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  },
);

it("supports older confirmations without displaying an internal ID as the order number", () => {
  saveOrderReceipt("cafe", "Cafe", { ...order, orderNumber: undefined });
  setup();
  expect(screen.getByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("order-a")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Copy order number" }),
  ).not.toBeInTheDocument();
});

it("copies only the saved readable number for communicating with counter staff", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const toast = vi.spyOn(feedback, "toast").mockImplementation(() => "copied");
  saveOrderReceipt("cafe", "Cafe", order);
  setup();
  await user.click(screen.getByRole("button", { name: "Show order number" }));
  expect(
    screen.getByText(
      "Tell the counter staff this number if your QR cannot be scanned.",
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Copy order number" }));
  expect(write).toHaveBeenCalledExactlyOnceWith("ORD-000042");
  expect(toast).toHaveBeenCalledWith("Order number copied.");
  expect(api.post).not.toHaveBeenCalled();
});

it("preserves the number and supports retry when clipboard permission is denied", async () => {
  const user = userEvent.setup();
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce();
  const toast = vi.spyOn(feedback, "toast").mockImplementation(() => "copied");
  saveOrderReceipt("cafe", "Cafe", order);
  setup();
  await user.click(screen.getByRole("button", { name: "Show order number" }));
  await user.click(screen.getByRole("button", { name: "Copy order number" }));
  expect(screen.getByRole("alert")).toHaveTextContent("copy it manually");
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(toast).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Copy order number" }));
  expect(write).toHaveBeenCalledTimes(2);
  expect(toast).toHaveBeenCalledWith("Order number copied.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
