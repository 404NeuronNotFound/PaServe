import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerOrder } from "./CustomerOrder";
import { useCart } from "../../features/cart/cart";
import { useCustomerTables } from "../../features/shops/customer-table";
import { api } from "../../lib/api/client";
import { pendingOrders } from "../../features/cart/pending-orders";
vi.mock("../../lib/api/client", () => ({ api: { post: vi.fn() } }));
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
const table = {
  shopSlug: "cafe",
  code: "T12",
  number: "12",
  checkoutToken: `context.${"a".repeat(43)}`,
};
const response = {
  data: {
    order: {
      id: "pickup-a",
      mode: "TAKEOUT",
      status: "PENDING_CONFIRMATION",
      table: null,
      totalPrice: "10.00",
      currency: "PHP",
      items: [
        {
          ...quote,
          basePrice: "10.00",
          unitPrice: "10.00",
          totalPrice: "10.00",
        },
      ],
      createdAt: "2026-10-12",
    },
  },
};
it("ignores a late order completion after leaving and recovers with the original request", async () => {
  let finish!: (result: typeof response) => void;
  vi.mocked(api.post).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const onPlaced = vi.fn();
  const first = render(<CustomerOrder shopSlug="cafe" onOrderPlaced={onPlaced} />);
  await placeOrder("Place pickup order");
  const original = vi.mocked(api.post).mock.calls[0][1];
  first.unmount();
  await act(async () => { finish(response); });
  expect(onPlaced).not.toHaveBeenCalled();
  expect(useCart.getState().shops.cafe).toHaveLength(1);
  expect(pendingOrders.read("paserve-pending-order:v1:cafe")).not.toBeNull();
  vi.mocked(api.post).mockResolvedValueOnce(response);
  render(<CustomerOrder shopSlug="cafe" onOrderPlaced={onPlaced} />);
  await userEvent.click(screen.getByRole("button", { name: "Confirm previous order" }));
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(original);
  expect(onPlaced).toHaveBeenCalledOnce();
  expect(useCart.getState().shops.cafe).toEqual([]);
});
beforeEach(() => {
  pendingOrders.clearMemory();
  sessionStorage.clear();
  vi.resetAllMocks();
  useCart.setState({ shops: {} });
  useCustomerTables.setState({ codes: {}, resolved: {} });
  useCart.getState().add("cafe", quote);
});
async function placeOrder(name: string) {
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  const submit = screen.queryByRole("button", { name });
  if (submit) await userEvent.click(submit);
}
it("defaults a tableless cart to pickup and submits without table fields", async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  render(<CustomerOrder shopSlug="cafe" />);
  expect(screen.getByRole("radio", { name: "Takeout / pickup" })).toBeChecked();
  expect(
    screen.queryByRole("radio", { name: /Dine-in/ }),
  ).not.toBeInTheDocument();
  await placeOrder("Place pickup order");
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/orders", {
    requestId: expect.any(String),
    reviewedTotal: quote.totalPrice,
    mode: "TAKEOUT",
    items: [{ productId: "coffee", quantity: 1, variantIds: [], addOnIds: [] }],
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Pickup order placed.",
  );
  expect(useCart.getState().shops.cafe).toEqual([]);
});
it.each(["TAKEOUT", "DINE_IN"] as const)(
  "keeps the internal ID out of a legacy %s inline receipt",
  async (mode) => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        order: {
          ...response.data.order,
          mode,
          table: mode === "DINE_IN" ? table : null,
        },
      },
    });
    if (mode === "DINE_IN") useCustomerTables.getState().setResolved(table);
    render(
      <CustomerOrder
        shopSlug="cafe"
        {...(mode === "DINE_IN" ? { table } : {})}
      />,
    );
    await placeOrder(
      mode === "DINE_IN" ? "Place dine-in order" : "Place pickup order",
    );
    const receipt = await screen.findByRole("status");
    expect(receipt).toHaveTextContent("Order reference: Unavailable");
    expect(receipt).toHaveTextContent("Ask the counter staff for help");
    expect(receipt).not.toHaveTextContent("pickup-a");
  },
);
it.each(["TAKEOUT", "DINE_IN"] as const)(
  "displays the friendly order number for %s without exposing secure identifiers",
  async (mode) => {
    const token = `cGF5bG9hZA.${"a".repeat(43)}`;
    vi.mocked(api.post).mockResolvedValue({
      data: {
        order: {
          ...response.data.order,
          mode,
          table: mode === "DINE_IN" ? table : null,
          orderNumber: "ORD-000042",
          paymentStatus: "UNPAID",
          updatedAt: "2026-10-12T00:00:00Z",
          qrToken: token,
          qrTokenExpiresAt: "2026-10-19T00:00:00Z",
        },
      },
    });
    if (mode === "DINE_IN") useCustomerTables.getState().setResolved(table);
    render(
      <CustomerOrder
        shopSlug="cafe"
        {...(mode === "DINE_IN" ? { table } : {})}
      />,
    );
    await placeOrder(
      mode === "DINE_IN" ? "Place dine-in order" : "Place pickup order",
    );
    const receipt = await screen.findByRole("status");
    expect(receipt).toHaveTextContent("Order reference: ORD-000042");
    expect(receipt).not.toHaveTextContent("pickup-a");
    expect(receipt).not.toHaveTextContent(token);
  },
);
it("lets a table customer choose pickup without submitting the remembered table", async () => {
  useCustomerTables.getState().setResolved(table);
  vi.mocked(api.post).mockResolvedValue(response);
  const onModeChange = vi.fn();
  render(
    <CustomerOrder shopSlug="cafe" table={table} onModeChange={onModeChange} />,
  );
  await userEvent.click(
    screen.getByRole("radio", { name: "Takeout / pickup" }),
  );
  expect(onModeChange).toHaveBeenLastCalledWith("TAKEOUT");
  await placeOrder("Place pickup order");
  expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("tableCode");
  expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("tableToken");
  expect(useCustomerTables.getState().codes.cafe).toBe("T12");
});
it("does not inherit unresolved table hints when pickup is explicitly selected", async () => {
  useCustomerTables.setState({ codes: { cafe: "T12" }, resolved: {} });
  vi.mocked(api.post).mockResolvedValue(response);
  render(<CustomerOrder shopSlug="cafe" />);
  await placeOrder("Place pickup order");
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Pickup order placed.",
  );
});
it("restores an uncertain pickup request without changing mode or request ID after a table scan", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValueOnce(response);
  const first = render(<CustomerOrder shopSlug="cafe" />);
  await placeOrder("Place pickup order");
  await screen.findByRole("alert");
  const sent = vi.mocked(api.post).mock.calls[0][1];
  first.unmount();
  useCustomerTables.getState().setResolved(table);
  render(<CustomerOrder shopSlug="cafe" table={table} />);
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toHaveTextContent("Takeout / pickup");
  expect(
    screen.queryByRole("radio", { name: /Dine-in/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(sent);
  expect(useCart.getState().shops.cafe).toEqual([]);
});
it("keeps pickup cart and retry request when a response unexpectedly binds a table", async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...response.data.order, table } },
  });
  render(<CustomerOrder shopSlug="cafe" />);
  await placeOrder("Place pickup order");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "not been confirmed",
  );
  expect(useCart.getState().shops.cafe).toHaveLength(1);
});
it("preserves an uncertain request after a later 404 rather than allowing a duplicate new order", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("lost"))
    .mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } })
    .mockResolvedValueOnce(response);
  render(<CustomerOrder shopSlug="cafe" />);
  await placeOrder("Place pickup order");
  await screen.findByRole("alert");
  const original = sessionStorage.getItem("paserve-pending-order:v1:cafe");
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(sessionStorage.getItem("paserve-pending-order:v1:cafe")).toBe(
    original,
  );
  expect(useCart.getState().shops.cafe).toHaveLength(1);
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(vi.mocked(api.post).mock.calls[2][1]).toEqual(
    vi.mocked(api.post).mock.calls[0][1],
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Waiting for Confirmation");
});
it("resolves a processed checkout retry without resubmitting the already saved cart", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { code: "ORDER_ALREADY_PROCESSED" } },
    });
  render(<CustomerOrder shopSlug="cafe" />);
  await placeOrder("Place pickup order");
  await screen.findByRole("alert");
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "already been processed at the counter",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm previous order" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();
  expect(useCart.getState().shops.cafe).toEqual([]);
  expect(sessionStorage.getItem("paserve-pending-order:v1:cafe")).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("preserves new and edited cart lines when the previous checkout was processed", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { code: "ORDER_ALREADY_PROCESSED" } },
    });
  render(<CustomerOrder shopSlug="cafe" />);
  await placeOrder("Place pickup order");
  await screen.findByRole("alert");
  const original = useCart.getState().shops.cafe[0];
  useCart.setState({
    shops: {
      cafe: [
        { ...original, quantity: 2, totalPrice: "20.00" },
        { ...original, lineId: "new-line", productName: "Next coffee" },
      ],
    },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "already been processed",
  );
  expect(useCart.getState().shops.cafe).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Review order" })).toBeEnabled();
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("retains the original request across cart closure when session storage is blocked", async () => {
  const blockedWrite = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  const blockedRead = vi
    .spyOn(Storage.prototype, "getItem")
    .mockImplementation(() => {
      throw new Error("blocked");
    });
  try {
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error("lost"))
      .mockResolvedValueOnce(response);
    const first = render(<CustomerOrder shopSlug="cafe" />);
    await placeOrder("Place pickup order");
    await screen.findByRole("alert");
    const original = vi.mocked(api.post).mock.calls[0][1];
    first.unmount();
    render(<CustomerOrder shopSlug="cafe" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Confirm previous order" }),
    );
    expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(original);
    expect(useCart.getState().shops.cafe).toEqual([]);
  } finally {
    blockedWrite.mockRestore();
    blockedRead.mockRestore();
  }
});
