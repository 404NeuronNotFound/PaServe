import { AxiosError, AxiosHeaders } from "axios";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CustomerCart } from "./CustomerCart";
import { CustomerOrder } from "./CustomerOrder";
import { useCart } from "../../features/cart/cart";
import { useCustomerTables } from "../../features/shops/customer-table";
import { api } from "../../lib/api/client";
import { pendingOrders } from "../../features/cart/pending-orders";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
vi.mock("../../lib/api/client", () => ({ api: { post: vi.fn() } }));
const configured: ProductSelectionQuoteResponse = {
  productId: "coffee",
  productName: "Coffee",
  currency: "PHP",
  basePrice: "10.00",
  unitPrice: "17.00",
  totalPrice: "34.00",
  quantity: 2,
  notes: "Less ice\nNo sugar",
  variants: [
    {
      id: "large",
      optionGroupId: "size",
      name: "Large",
      priceAdjustment: "5.00",
      isDefault: false,
    },
  ],
  addOns: [{ id: "milk", name: "Oat milk", priceAdjustment: "2.00" }],
};
const regular: ProductSelectionQuoteResponse = {
  ...configured,
  unitPrice: "10.00",
  totalPrice: "10.00",
  quantity: 1,
  notes: undefined,
  variants: [],
  addOns: [],
};
const table = {
  shopSlug: "cafe",
  code: "T12",
  number: "Patio 4",
  checkoutToken: `context.${"a".repeat(43)}`,
};
const receipt = {
  data: {
    order: {
      id: "order-a",
      mode: "TAKEOUT",
      table: null,
      status: "PENDING_CONFIRMATION",
      currency: "PHP",
      totalPrice: "44.00",
      items: [configured, regular],
      createdAt: "2026-10-12",
    },
  },
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
  pendingOrders.clearMemory();
  vi.resetAllMocks();
  sessionStorage.clear();
  useCart.setState({ shops: {} });
  useCustomerTables.setState({ codes: {}, resolved: {} });
  useCart.getState().add("cafe", configured);
  useCart.getState().add("cafe", regular);
  useCart
    .getState()
    .add("other", { ...regular, productName: "Other shop tea" });
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
  if (show)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", show);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
async function openCart() {
  render(
    <CustomerCart shop={{ slug: "cafe", name: "Cafe", description: null }} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "View cart (3)" }));
}
it("undoes removals in reverse order with the original configured lines and shop isolation", async () => {
  const original = useCart.getState().shops.cafe;
  const other = useCart.getState().shops.other;
  await openCart();
  await userEvent.click(screen.getAllByRole("button", { name: "Remove Coffee" })[0]);
  await userEvent.click(screen.getByRole("button", { name: "Remove Coffee" }));
  expect(useCart.getState().shops.cafe).toEqual([]);
  await userEvent.click(screen.getByRole("button", { name: "Undo removal of Coffee" }));
  expect(useCart.getState().shops.cafe).toEqual([original[1]]);
  await userEvent.click(screen.getByRole("button", { name: "Undo removal of Coffee" }));
  expect(useCart.getState().shops.cafe).toEqual(original);
  expect(useCart.getState().shops.other).toBe(other);
  expect(screen.getByRole("status", { name: "Cart total" })).toHaveTextContent("44.00");
  expect(api.post).not.toHaveBeenCalled();
});

it("retires removal undo before review and protects unsaved item edits", async () => {
  await openCart();
  await userEvent.click(screen.getByRole("button", { name: "Edit notes for Coffee" }));
  for (const button of screen.getAllByRole("button", { name: "Remove Coffee" })) expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await userEvent.click(screen.getAllByRole("button", { name: "Remove Coffee" })[1]);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  expect(screen.queryByRole("button", { name: /Undo removal/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Edit cart" }));
  expect(screen.queryByRole("button", { name: /Undo removal/ })).not.toBeInTheDocument();
});
it("explains per-item charges and keeps the reviewed total with the final action", async () => {
  await openCart();
  const progress = within(screen.getByRole("list", { name: "Checkout progress" }));
  expect(progress.getByText("1. Cart")).toHaveAttribute("aria-current", "step");
  const lines = within(screen.getByRole("list", { name: "Cart items" })).getAllByRole("listitem");
  const configuredLine = within(lines[0]);
  expect(configuredLine.getByText("Variants: Large")).toBeVisible();
  expect(configuredLine.getByText("Add-ons: Oat milk")).toBeVisible();
  await userEvent.click(configuredLine.getByText("Price breakdown"));
  expect(configuredLine.getByText("Base price").parentElement).toHaveTextContent("₱10.00");
  expect(configuredLine.getByText("+₱5.00")).toBeVisible();
  expect(configuredLine.getByText("+₱2.00")).toBeVisible();
  expect(configuredLine.getByText("Configured unit price").parentElement).toHaveTextContent("₱17.00");
  expect(lines[0]).toHaveTextContent("₱34.00");
  expect(api.post).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  expect(progress.getByText("2. Review")).toHaveAttribute("aria-current", "step");
  const footer = within(screen.getByRole("dialog").querySelector("footer")!);
  expect(footer.getByText("Total to confirm").parentElement).toHaveTextContent("₱44.00");
  expect(footer.getByRole("button", { name: "Place pickup order" })).toBeEnabled();
  expect(footer.getByText(/cashier will confirm/)).toBeVisible();
  await userEvent.click(footer.getByRole("button", { name: "Edit cart" }));
  expect(progress.getByText("1. Cart")).toHaveAttribute("aria-current", "step");
  expect(screen.getByRole("list", { name: "Cart items" })).toBeVisible();
});

it("labels zero-cost options without adding charges to the total", async () => {
  const line = useCart.getState().shops.cafe[0];
  useCart.setState({ shops: { ...useCart.getState().shops, cafe: [{ ...line,
    variants: [...line.variants, { id: "hot", name: "Hot", optionGroupId: "temperature", priceAdjustment: "0.00", isDefault: true }],
    addOns: [...line.addOns, { id: "cinnamon", name: "Cinnamon", priceAdjustment: "0.00" }],
  }, useCart.getState().shops.cafe[1]] } });
  await openCart();
  const row = within(within(screen.getByRole("list", { name: "Cart items" })).getAllByRole("listitem")[0]);
  await userEvent.click(row.getByText("Price breakdown"));
  expect(row.getByText("Included")).toBeVisible();
  expect(row.getByText("Free")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("₱44.00");
  expect(api.post).not.toHaveBeenCalled();
});
it("keeps the cart dialog open and blocks duplicate submission until the order response settles", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.post).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
  await openCart();
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  await userEvent.click(screen.getByRole("button", { name: "Place pickup order" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(api.post).toHaveBeenCalledOnce();
  await act(async () => { reject(new Error("Response lost")); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  await userEvent.click(screen.getByRole("button", { name: "View cart (3)" }));
  expect(screen.getByRole("button", { name: "Confirm previous order" })).toBeEnabled();
  expect(api.post).toHaveBeenCalledOnce();
});
it("shows separate configured lines, quantities, notes, subtotal and pickup type before any submission", async () => {
  vi.mocked(api.post).mockResolvedValue(receipt);
  await openCart();
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  const review = screen.getByRole("region", { name: "Review your order" });
  expect(review).toHaveTextContent("Takeout / pickup");
  expect(
    within(review).getAllByRole("heading", { name: "Coffee" }),
  ).toHaveLength(2);
  expect(review).toHaveTextContent("Quantity: 2");
  expect(review).toHaveTextContent("Quantity: 1");
  expect(review).toHaveTextContent("Variants: Large");
  expect(review).toHaveTextContent("Add-ons: Oat milk");
  expect(review).toHaveTextContent("Notes: Less ice No sugar");
  expect(review).not.toHaveTextContent("Notes: None");
  expect(review).toHaveTextContent("Estimated subtotal₱44.00");
  expect(review).not.toHaveTextContent("Other shop tea");
  expect(within(review).queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
  expect(
    within(review).getByRole("heading", { name: "Review your order" }),
  ).toHaveFocus();
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/orders", {
    mode: "TAKEOUT",
    reviewedTotal: "44.00",
    requestId: expect.any(String),
    items: [
      {
        productId: "coffee",
        quantity: 2,
        variantIds: ["large"],
        addOnIds: ["milk"],
        notes: "Less ice\nNo sugar",
      },
      { productId: "coffee", quantity: 1, variantIds: [], addOnIds: [] },
    ],
  });
  expect(useCart.getState().shops.other).toHaveLength(1);
});
it("requires a separate confirmation for updated server prices without sending client pricing as authority", async () => {
  useCart.setState({ shops: {} });
  useCart.getState().add("cafe", { ...configured, basePrice: "0.01", unitPrice: "0.01", totalPrice: "0.02" });
  const updated = { ...configured, basePrice: "21.25", unitPrice: "28.25", totalPrice: "56.50" };
  vi.mocked(api.post).mockRejectedValueOnce(new AxiosError("Prices changed", undefined, undefined, undefined, {
    status: 409, statusText: "Conflict", headers: {}, config: { headers: new AxiosHeaders() },
    data: { code: "ORDER_PRICE_CHANGED", currency: "PHP", totalPrice: "56.50", items: [updated] },
  })).mockResolvedValueOnce({ data: { order: { ...receipt.data.order, totalPrice: "56.50", items: [updated] } } });
  const placed = vi.fn();
  render(<CustomerOrder shopSlug="cafe" onOrderPlaced={placed} />);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  await userEvent.click(screen.getByRole("button", { name: "Place pickup order" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("No order was placed");
  expect(screen.getByRole("heading", { name: "Review your order" })).toHaveFocus();
  expect(screen.getByRole("region", { name: "Review your order" })).toHaveTextContent("56.50");
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(placed).not.toHaveBeenCalled();
  expect(useCart.getState().shops.cafe).toHaveLength(1);
  expect(sessionStorage.getItem("paserve-pending-order:v1:cafe")).toBeNull();
  const original = vi.mocked(api.post).mock.calls[0][1] as { requestId: string; reviewedTotal: string };
  expect(original.reviewedTotal).toBe("0.02");
  await userEvent.click(screen.getByRole("button", { name: "Place pickup order" }));
  const confirmed = vi.mocked(api.post).mock.calls[1][1] as { requestId: string; reviewedTotal: string; items: Record<string, unknown>[] };
  expect(confirmed.reviewedTotal).toBe("56.50");
  expect(confirmed.requestId).not.toBe(original.requestId);
  expect(confirmed.items[0]).not.toHaveProperty("unitPrice");
  expect(placed).toHaveBeenCalledOnce();
  expect(useCart.getState().shops.cafe).toEqual([]);
});

it("lets the customer return to editing without submitting", async () => {
  await openCart();
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  await userEvent.click(screen.getByRole("button", { name: "Edit cart" }));
  expect(
    screen.queryByRole("region", { name: "Review your order" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Review order" })).toBeEnabled();
  expect(screen.getAllByRole("spinbutton")).toHaveLength(2);
  expect(api.post).not.toHaveBeenCalled();
});
it("does not submit when Review order is double-clicked", async () => {
  render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.dblClick(
    screen.getByRole("button", { name: "Review order" }),
  );
  expect(api.post).not.toHaveBeenCalled();
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toBeInTheDocument();
});
it("sends a pending order only once when confirmation is clicked repeatedly", async () => {
  let finish!: (value: typeof receipt) => void;
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  const submit = screen.getByRole("button", { name: "Place pickup order" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Placing order…" })).toBeDisabled();
  await act(async () => {
    finish(receipt);
  });
  expect(screen.getByRole("status")).toHaveTextContent("Waiting for Confirmation");
});
it("preserves every selected modifier through review, Edit cart and a fresh review", async () => {
  useCart.setState({ shops: { ...useCart.getState().shops, cafe: [] } });
  useCart.getState().add("cafe", {
    ...configured,
    unitPrice: "20.00",
    totalPrice: "40.00",
    variants: [
      ...configured.variants,
      {
        id: "hot",
        optionGroupId: "temperature",
        name: "Hot",
        priceAdjustment: "0.00",
        isDefault: true,
      },
    ],
    addOns: [
      ...configured.addOns,
      { id: "shot", name: "Extra shot", priceAdjustment: "3.00" },
      { id: "cinnamon", name: "Cinnamon", priceAdjustment: "0.00" },
    ],
  });
  useCart.getState().add("cafe", regular);
  const saved = useCart.getState().shops;
  await openCart();
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  const review = screen.getByRole("region", { name: "Review your order" });
  expect(review).toHaveTextContent("Variants: Large, Hot");
  expect(review).toHaveTextContent("Add-ons: Oat milk, Extra shot, Cinnamon");
  expect(review).toHaveTextContent("Estimated subtotal₱50.00");
  await userEvent.click(screen.getByRole("button", { name: "Edit cart" }));
  const cart = screen.getByRole("dialog", { name: "Cafe cart" });
  const lines = within(within(cart).getByRole("list", { name: "Cart items" })).getAllByRole("listitem");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent("Variants: Large, Hot");
  expect(lines[0]).toHaveTextContent("Add-ons: Oat milk, Extra shot, Cinnamon");
  expect(lines[0]).toHaveTextContent("Less ice No sugar");
  expect(within(lines[0]).getByRole("spinbutton")).toHaveValue(2);
  expect(within(lines[1]).getByRole("spinbutton")).toHaveValue(1);
  expect(lines[1]).not.toHaveTextContent("Large");
  expect(lines[1]).not.toHaveTextContent("Extra shot");
  expect(
    within(cart).getByRole("radio", { name: "Takeout / pickup" }),
  ).toBeChecked();
  expect(useCart.getState().shops).toBe(saved);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  const repeated = screen.getByRole("region", { name: "Review your order" });
  expect(repeated).toHaveTextContent("Variants: Large, Hot");
  expect(repeated).toHaveTextContent("Add-ons: Oat milk, Extra shot, Cinnamon");
  expect(repeated).toHaveTextContent("Estimated subtotal₱50.00");
  expect(api.post).not.toHaveBeenCalled();
});
it("requires save/cancel for note drafts and waits for quantity repricing before review", async () => {
  await openCart();
  await userEvent.click(
    screen.getByRole("button", { name: "Edit notes for Coffee" }),
  );
  expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Review order" })).toBeEnabled();
  const quantity = screen.getAllByRole("spinbutton")[0];
  fireEvent.change(quantity, { target: { value: "3" } });
  expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();
  let finish!: (value: unknown) => void;
  vi.mocked(api.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Update quantity for Coffee" }),
  );
  expect(screen.getByRole("button", { name: "Review order" })).toBeDisabled();
  await act(async () => {
    finish({ data: { ...configured, quantity: 3, totalPrice: "51.00" } });
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Review order" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toHaveTextContent("Estimated subtotal₱61.00");
});
it("invalidates the review when the cart changes, without silently sending newer selections", async () => {
  render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  const first = useCart.getState().shops.cafe[0];
  act(() => {
    useCart.getState().updateNotes("cafe", first, "New note");
  });
  expect(
    screen.queryByRole("button", { name: "Place pickup order" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toHaveTextContent("Notes: New note");
  expect(api.post).not.toHaveBeenCalled();
});
it("shows dine-in and the resolved table in the review", async () => {
  useCustomerTables.getState().setResolved(table);
  render(<CustomerOrder shopSlug="cafe" table={table} />);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toHaveTextContent("Dine-in");
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toHaveTextContent("Patio 4");
  expect(
    screen.getByRole("button", { name: "Place dine-in order" }),
  ).toBeEnabled();
  expect(api.post).not.toHaveBeenCalled();
});
it("restores the original reviewed selections for an uncertain retry even if the live cart changes", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("lost"));
  const first = render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  await screen.findByRole("alert");
  first.unmount();
  const original = useCart.getState().shops.cafe[0];
  useCart.getState().updateNotes("cafe", original, "Changed after submission");
  render(<CustomerOrder shopSlug="cafe" />);
  const review = screen.getByRole("region", { name: "Review your order" });
  expect(review).toHaveTextContent("Less ice No sugar");
  expect(review).not.toHaveTextContent("Changed after submission");
  expect(
    screen.queryByRole("button", { name: "Edit cart" }),
  ).not.toBeInTheDocument();
});
