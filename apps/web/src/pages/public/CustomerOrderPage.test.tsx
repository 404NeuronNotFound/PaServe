import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomerOrderResponse } from "@paserve/contracts";
import { CustomerOrderPage } from "./CustomerOrderPage";
import { PublicMenuPage } from "./PublicMenuPage";
import {
  orderReceipts,
  saveOrderReceipt,
} from "../../features/cart/order-receipt";
import { pendingOrders } from "../../features/cart/pending-orders";
import { useCart } from "../../features/cart/cart";
import { useCustomerTables } from "../../features/shops/customer-table";
import { api } from "../../lib/api/client";
import { feedback } from "../../app/stores/feedback";

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
  orderReceipts.clearMemory();
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
  vi.restoreAllMocks();
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
      name: "Order submitted",
    });
    await waitFor(() => expect(title).toHaveFocus());
    expect(screen.getByText("ORD-000042")).toBeInTheDocument();
    expect(screen.getByText("₱12.00")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Pending");
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
    expect(screen.getByRole("status")).toHaveTextContent("Pending");
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

it("keeps checkout open and preserves the cart when the response cannot be confirmed", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      shop: { slug: "cafe", name: "Cafe", description: null },
      categories: [],
      products: [],
      featuredProducts: [],
    },
  });
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...order, totalPrice: "1.00" } },
  });
  useCart.getState().add("cafe", quote);
  setup("/menu/cafe");
  await screen.findByRole("heading", { name: "Cafe" });
  await userEvent.click(screen.getByRole("button", { name: "View cart (1)" }));
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "not been confirmed",
  );
  expect(
    screen.queryByRole("heading", { name: "Order submitted" }),
  ).not.toBeInTheDocument();
  expect(useCart.getState().shops.cafe).toHaveLength(1);
  expect(
    sessionStorage.getItem("paserve-order-receipt:v1:cafe:order-a"),
  ).toBeNull();
});

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
      "check it before placing another",
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
  expect(screen.getByRole("status")).toHaveTextContent("Pending");
});

it.each(["invalid", "-1.00", "12.345"])(
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
  expect(
    screen.getByRole("region", { name: "Order number" }),
  ).toHaveTextContent(
    "Tell the counter staff this number if your QR cannot be scanned.",
  );
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
  await user.click(screen.getByRole("button", { name: "Copy order number" }));
  expect(screen.getByRole("alert")).toHaveTextContent("copy it manually");
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(toast).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Copy order number" }));
  expect(write).toHaveBeenCalledTimes(2);
  expect(toast).toHaveBeenCalledWith("Order number copied.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
