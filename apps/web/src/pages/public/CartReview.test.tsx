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
it("never submits saved frontend price snapshots and displays the server's recalculated total", async () => {
  useCart.setState({ shops: {} });
  useCart.getState().add("cafe", {
    ...configured,
    basePrice: "0.01",
    unitPrice: "0.01",
    totalPrice: "0.02",
    variants: configured.variants.map((option) => ({
      ...option,
      priceAdjustment: "0.00",
    })),
    addOns: configured.addOns.map((option) => ({
      ...option,
      priceAdjustment: "0.00",
    })),
  });
  vi.mocked(api.post).mockResolvedValue({
    data: {
      order: {
        ...receipt.data.order,
        totalPrice: "56.50",
        items: [
          {
            ...configured,
            basePrice: "20.03",
            unitPrice: "28.25",
            totalPrice: "56.50",
            variants: configured.variants.map((option) => ({
              ...option,
              priceAdjustment: "6.07",
            })),
            addOns: configured.addOns.map((option) => ({
              ...option,
              priceAdjustment: "2.15",
            })),
          },
        ],
      },
    },
  });
  render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(screen.getByRole("button", { name: "Review order" }));
  expect(
    screen.getByRole("region", { name: "Review your order" }),
  ).toHaveTextContent("Estimated subtotal₱0.02");
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/orders", {
    mode: "TAKEOUT",
    requestId: expect.any(String),
    items: [
      {
        productId: "coffee",
        quantity: 2,
        variantIds: ["large"],
        addOnIds: ["milk"],
        notes: "Less ice\nNo sugar",
      },
    ],
  });
  expect(await screen.findByRole("status")).toHaveTextContent("Total ₱56.50");
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
  const lines = within(cart).getAllByRole("listitem");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toHaveTextContent(
    "Large, Hot, Oat milk, Extra shot, Cinnamon",
  );
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
