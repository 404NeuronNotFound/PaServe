import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicMenuView } from "./PublicMenuView";
import { api } from "../../lib/api/client";
import { useCart, sumPrices } from "../../features/cart/cart";
import { useFeedbackStore } from "../../app/stores/feedback";
import type {
  PublicMenuResponse,
  PublicProductDetailsResponse,
} from "@paserve/contracts";

vi.mock("../../lib/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
const product: PublicMenuResponse["products"][number] = {
  id: "product",
  categoryId: null,
  name: "Coffee",
  slug: "coffee",
  description: "Fresh coffee",
  price: "120.01",
  imageUrl: "https://example.com/coffee.webp",
  status: "AVAILABLE",
  isOrderable: true,
  isFeatured: false,
  sortOrder: 0,
};
const menu: PublicMenuResponse = {
  shop: { name: "Cafe", slug: "cafe", description: null },
  products: [product],
  categories: [],
  featuredProducts: [],
};
const details: PublicProductDetailsResponse = {
  product,
  optionGroups: [{ id: "size", name: "Size", isRequired: true }],
  variants: [
    {
      id: "regular",
      optionGroupId: "size",
      name: "Regular",
      priceAdjustment: "0.00",
      isDefault: true,
    },
    {
      id: "large",
      optionGroupId: "size",
      name: "Large",
      priceAdjustment: "30.10",
      isDefault: false,
    },
  ],
  addOns: [{ id: "milk", name: "Oat milk", priceAdjustment: "25.20" }],
};
const showDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  vi.resetAllMocks();
  useCart.setState({ shops: {} });
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
  vi.mocked(api.get).mockResolvedValue({ data: details });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useFeedbackStore.getState().clear();
  useCart.setState({ shops: {} });
  if (showDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      showDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
function setup(data = menu, preview = false) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <PublicMenuView menu={data} preview={preview} />
    </QueryClientProvider>,
  );
  return { client, ...view };
}
async function openDetails() {
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", {
    name: "View details for Coffee",
  });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Coffee" });
  await within(dialog).findByLabelText(/Quantity/);
  return { user, dialog, trigger };
}
it("shows fresh product information and restores keyboard focus when closed", async () => {
  setup();
  const { user, dialog, trigger } = await openDetails();
  expect(within(dialog).getByText("Fresh coffee")).toBeInTheDocument();
  expect(within(dialog).getByRole("img", { name: "Coffee" })).toHaveAttribute(
    "src",
    product.imageUrl,
  );
  expect(within(dialog).getAllByText("₱120.01")).toHaveLength(2);
  expect(within(dialog).getByRole("radio", { name: /Regular/ })).toBeChecked();
  expect(api.get).toHaveBeenCalledWith("/menu/cafe/products/product", {
    signal: expect.any(AbortSignal),
  });
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  await vi.waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("renders updated backend details instead of the menu card snapshot", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      product: {
        ...product,
        name: "Updated coffee",
        description: "New roast description",
        imageUrl: "https://example.com/new-roast.webp",
        price: "127.99",
      },
      variants: [details.variants[0]],
      addOns: [],
    },
  });
  setup();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "View details for Coffee" }));
  const dialog = await screen.findByRole("dialog", { name: "Updated coffee" });
  expect(within(dialog).getByText("New roast description")).toBeInTheDocument();
  expect(
    within(dialog).getByRole("img", { name: "Updated coffee" }),
  ).toHaveAttribute("src", "https://example.com/new-roast.webp");
  expect(within(dialog).getAllByText("₱127.99")).toHaveLength(2);
  expect(within(dialog).queryByText("Fresh coffee")).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("radio", { name: /Large/ }),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).queryByRole("checkbox", { name: /Oat milk/ }),
  ).not.toBeInTheDocument();
});
it("adds a server-quoted customized item and allows cart review/removal", async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      productId: product.id,
      productName: "Coffee",
      currency: "PHP",
      basePrice: "120.01",
      unitPrice: "175.32",
      totalPrice: "350.64",
      quantity: 2,
      notes: "<b>No sugar</b>",
      variants: [details.variants[1]],
      addOns: details.addOns,
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  await user.click(within(dialog).getByRole("radio", { name: /Large/ }));
  await user.click(within(dialog).getByRole("checkbox", { name: /Oat milk/ }));
  await user.clear(within(dialog).getByLabelText(/Quantity/));
  await user.type(within(dialog).getByLabelText(/Quantity/), "2");
  await user.type(within(dialog).getByLabelText(/Notes/), "<b>No sugar</b>");
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱350.62");
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/products/product/quote", {
    variantIds: ["large"],
    addOnIds: ["milk"],
    quantity: 2,
    notes: "<b>No sugar</b>",
  });
  await user.click(
    await screen.findByRole("button", { name: "View cart (2)" }),
  );
  const cart = screen.getByRole("dialog", { name: "Cafe cart" });
  expect(within(cart).getByText("₱350.64")).toBeInTheDocument();
  expect(within(cart).getByText("<b>No sugar</b>")).toBeInTheDocument();
  expect(cart.querySelector("b")).toBeNull();
  expect(within(cart).getByText("Large, Oat milk")).toBeInTheDocument();
  await user.click(within(cart).getByRole("button", { name: "Remove Coffee" }));
  expect(within(cart).getByText("Your cart is empty.")).toBeInTheDocument();
});
it("blocks invalid quantities and required choices", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      variants: details.variants.map((variant) => ({
        ...variant,
        isDefault: false,
      })),
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  const add = within(dialog).getByRole("button", { name: "Add to cart" });
  expect(add).toBeDisabled();
  await user.click(within(dialog).getByRole("radio", { name: /Large/ }));
  expect(add).toBeEnabled();
  await user.clear(within(dialog).getByLabelText(/Quantity/));
  await user.type(within(dialog).getByLabelText(/Quantity/), "100");
  expect(add).toBeDisabled();
  expect(within(dialog).getByRole("alert")).toHaveTextContent("1 to 99");
  expect(api.post).not.toHaveBeenCalled();
});
it("keeps sold-out details inspectable without allowing cart additions", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      product: { ...product, status: "SOLD_OUT", isOrderable: false },
    },
  });
  setup();
  const { dialog } = await openDetails();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeDisabled();
  expect(within(dialog).getByLabelText(/Quantity/)).toBeDisabled();
  expect(within(dialog).getAllByRole("status")[0]).toHaveTextContent(
    "Sold out",
  );
});
it("handles failed image loading and quote errors without losing the draft", async () => {
  vi.mocked(api.post).mockRejectedValue(new Error("Unavailable"));
  setup();
  const { user, dialog } = await openDetails();
  fireEvent.error(within(dialog).getByRole("img", { name: "Coffee" }));
  expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
  await user.type(within(dialog).getByLabelText(/Notes/), "Please serve warm");
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "could not add",
  );
  expect(within(dialog).getByLabelText(/Notes/)).toHaveValue(
    "Please serve warm",
  );
  expect(useCart.getState().shops).toEqual({});
});
it("supports unavailable details recovery and Escape dismissal", async () => {
  vi.mocked(api.get)
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce({ data: details });
  setup();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "View details for Coffee" }),
  );
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByRole("alert");
  await user.click(within(dialog).getByRole("button", { name: "Try again" }));
  await within(dialog).findByLabelText(/Quantity/);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("does not add late quotes after leaving the current menu", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(api.post).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = setup();
  const { user, dialog } = await openDetails();
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
  view.unmount();
  await act(async () => resolve({ data: { productId: product.id } }));
  expect(useCart.getState().shops).toEqual({});
});
it("does not modify the customer cart from an owner preview", async () => {
  setup(menu, true);
  const { dialog } = await openDetails();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: /View cart/ }),
  ).not.toBeInTheDocument();
});
it("isolates cart lines by shop and preserves exact totals", () => {
  const quote = {
    productId: product.id,
    productName: "Coffee",
    currency: "PHP" as const,
    basePrice: "120.01",
    unitPrice: "120.01",
    totalPrice: "240.02",
    quantity: 2,
    variants: [],
    addOns: [],
  };
  useCart.getState().add("cafe", quote);
  useCart.getState().add("other", { ...quote, totalPrice: "99.99" });
  expect(useCart.getState().shops.cafe[0].totalPrice).toBe("240.02");
  expect(useCart.getState().shops.other[0].totalPrice).toBe("99.99");
  expect(sumPrices(["120.01", "30.10", "25.20"], 3)).toBe("525.93");
});
