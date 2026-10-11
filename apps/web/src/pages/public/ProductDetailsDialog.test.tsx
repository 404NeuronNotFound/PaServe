import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  expect(within(cart).getByRole("status")).toHaveTextContent("₱350.64");
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
it("replaces variant surcharges and multiplies the preview by quantity", async () => {
  setup();
  const { user, dialog } = await openDetails();
  const regular = within(dialog).getByRole("radio", { name: /Regular/ });
  const large = within(dialog).getByRole("radio", { name: /Large/ });
  const total = within(dialog).getByRole("status");
  await user.click(large);
  expect(regular).not.toBeChecked();
  expect(total).toHaveTextContent("₱150.11");
  await user.clear(within(dialog).getByLabelText(/Quantity/));
  await user.type(within(dialog).getByLabelText(/Quantity/), "3");
  expect(total).toHaveTextContent("₱450.33");
  await user.click(regular);
  expect(large).not.toBeChecked();
  expect(total).toHaveTextContent("₱360.03");
});
it("steps quantity within its limits and keeps exact totals", async () => {
  setup();
  const { user, dialog } = await openDetails();
  const quantity = within(dialog).getByLabelText("Quantity");
  const decrease = within(dialog).getByRole("button", {
    name: "Decrease quantity",
  });
  const increase = within(dialog).getByRole("button", {
    name: "Increase quantity",
  });
  expect(decrease).toBeDisabled();
  await user.click(increase);
  expect(quantity).toHaveValue(2);
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱240.02");
  await user.click(decrease);
  expect(quantity).toHaveValue(1);
  await user.clear(quantity);
  await user.type(quantity, "99");
  expect(increase).toBeDisabled();
  await user.clear(quantity);
  expect(increase).toBeDisabled();
  expect(decrease).toBeDisabled();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});
it("explains included choices, free extras and a missing required selection", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      variants: details.variants.map((variant) => ({
        ...variant,
        isDefault: false,
      })),
      addOns: [{ id: "no-sugar", name: "No sugar", priceAdjustment: "0.00" }],
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  expect(
    within(dialog).getByRole("radio", { name: /Regular/ }),
  ).toHaveAccessibleName("Regular Included");
  expect(
    within(dialog).getByRole("checkbox", { name: /No sugar/ }),
  ).toHaveAccessibleName("No sugar Free");
  expect(
    within(dialog).getByText("Choose the required options to continue."),
  ).toBeInTheDocument();
  await user.click(within(dialog).getByRole("radio", { name: /Regular/ }));
  expect(
    within(dialog).queryByText("Choose the required options to continue."),
  ).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeEnabled();
});
it("combines independent groups and allows clearing an optional choice", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      optionGroups: [
        ...details.optionGroups,
        { id: "temperature", name: "Temperature", isRequired: false },
      ],
      variants: [
        ...details.variants,
        {
          id: "iced",
          optionGroupId: "temperature",
          name: "Iced",
          priceAdjustment: "5.02",
          isDefault: false,
        },
      ],
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  const optional = within(dialog).getByRole("group", {
    name: "Temperature (optional)",
  });
  expect(optional).toHaveAccessibleDescription(
    "Choose one option or leave this group unselected.",
  );
  const none = within(optional).getByRole("radio", { name: "No selection" });
  expect(none).toBeChecked();
  await user.click(within(dialog).getByRole("radio", { name: /Large/ }));
  await user.click(within(optional).getByRole("radio", { name: /Iced/ }));
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱155.13");
  await user.click(none);
  expect(
    within(optional).getByRole("radio", { name: /Iced/ }),
  ).not.toBeChecked();
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱150.11");
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeEnabled();
});
it("supports optional ungrouped variants with a free default", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      optionGroups: [],
      variants: details.variants.map((variant) => ({
        ...variant,
        optionGroupId: null,
      })),
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  const options = within(dialog).getByRole("group", {
    name: "Options (optional)",
  });
  expect(within(options).getByRole("radio", { name: /Regular/ })).toBeChecked();
  await user.click(within(options).getByRole("radio", { name: /Large/ }));
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱150.11");
  await user.click(
    within(options).getByRole("radio", { name: "No selection" }),
  );
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱120.01");
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeEnabled();
});
it("explains and blocks required groups without available variants", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { ...details, variants: [] } });
  setup();
  const { dialog } = await openDetails();
  const group = within(dialog).getByRole("group", { name: "Size (required)" });
  expect(group).toHaveAccessibleDescription(
    "No choices are currently available. This item cannot be added until a choice is available.",
  );
  expect(within(group).queryByRole("radio")).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeDisabled();
  expect(api.post).not.toHaveBeenCalled();
});
it("renders allowed paid and free add-ons and removes deselected price deltas", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      addOns: [
        ...details.addOns,
        { id: "shot", name: "Extra shot", priceAdjustment: "1.05" },
        { id: "no-sugar", name: "No sugar", priceAdjustment: "0.00" },
      ],
    },
  });
  vi.mocked(api.post).mockRejectedValue(new Error("Unavailable"));
  setup();
  const { user, dialog } = await openDetails();
  const group = within(dialog).getByRole("group", {
    name: "Add-ons (optional)",
  });
  expect(group).toHaveAccessibleDescription(
    "Choose any extras. Each applies once per item.",
  );
  const milk = within(group).getByRole("checkbox", { name: /Oat milk/ });
  const shot = within(group).getByRole("checkbox", { name: /Extra shot/ });
  const free = within(group).getByRole("checkbox", { name: /No sugar/ });
  expect(milk).toHaveAccessibleName("Oat milk +₱25.20");
  expect(free).toHaveAccessibleName("No sugar Free");
  expect(within(group).getAllByRole("checkbox")).toHaveLength(3);
  expect(milk).not.toBeChecked();
  await user.click(milk);
  await user.click(shot);
  await user.click(free);
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱146.26");
  await user.clear(within(dialog).getByLabelText(/Quantity/));
  await user.type(within(dialog).getByLabelText(/Quantity/), "3");
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱438.78");
  await user.click(milk);
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱363.18");
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  await within(dialog).findByRole("alert");
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/products/product/quote", {
    variantIds: ["regular"],
    addOnIds: ["shot", "no-sugar"],
    quantity: 3,
  });
});
it("retains selected paid/free add-ons in the cart with the expected preview total", async () => {
  const free = { id: "no-sugar", name: "No sugar", priceAdjustment: "0.00" };
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      addOns: [
        ...details.addOns,
        { id: "shot", name: "Extra shot", priceAdjustment: "1.05" },
        free,
      ],
    },
  });
  vi.mocked(api.post).mockResolvedValue({
    data: {
      productId: product.id,
      productName: "Coffee",
      currency: "PHP",
      basePrice: "120.01",
      unitPrice: "175.31",
      totalPrice: "525.93",
      quantity: 3,
      variants: [details.variants[1]],
      addOns: [details.addOns[0], free],
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  await user.click(within(dialog).getByRole("radio", { name: /Large/ }));
  await user.click(within(dialog).getByRole("checkbox", { name: /Oat milk/ }));
  await user.click(within(dialog).getByRole("checkbox", { name: /No sugar/ }));
  const shot = within(dialog).getByRole("checkbox", { name: /Extra shot/ });
  await user.click(shot);
  await user.clear(within(dialog).getByLabelText(/Quantity/));
  await user.type(within(dialog).getByLabelText(/Quantity/), "3");
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱529.08");
  await user.click(shot);
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱525.93");
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  await user.click(
    await screen.findByRole("button", { name: "View cart (3)" }),
  );
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/products/product/quote", {
    variantIds: ["large"],
    addOnIds: ["milk", "no-sugar"],
    quantity: 3,
  });
  expect(useCart.getState().shops.cafe[0]).toMatchObject({
    quantity: 3,
    unitPrice: "175.31",
    totalPrice: "525.93",
    addOns: [details.addOns[0], free],
  });
  const cart = screen.getByRole("dialog", { name: "Cafe cart" });
  expect(
    within(cart).getByText("Large, Oat milk, No sugar"),
  ).toBeInTheDocument();
  expect(within(cart).queryByText(/Extra shot/)).not.toBeInTheDocument();
  expect(within(cart).getByRole("status")).toHaveTextContent("₱525.93");
});
it("caps add-on selections while keeping selected choices removable", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      addOns: Array.from({ length: 51 }, (_, index) => ({
        id: `extra-${index}`,
        name: `Extra ${index}`,
        priceAdjustment: "0.01",
      })),
    },
  });
  setup();
  const { user, dialog } = await openDetails();
  const group = within(dialog).getByRole("group", {
    name: "Add-ons (optional)",
  });
  const checkboxes = within(group).getAllByRole("checkbox");
  for (const checkbox of checkboxes.slice(0, 50)) fireEvent.click(checkbox);
  expect(group).toHaveAccessibleDescription(
    "Choose up to 50 extras. 50 selected. Each applies once per item.",
  );
  expect(checkboxes[50]).toBeDisabled();
  expect(checkboxes[0]).toBeEnabled();
  expect(within(dialog).getByRole("status")).toHaveTextContent("₱120.51");
  await user.click(checkboxes[0]);
  expect(checkboxes[50]).toBeEnabled();
  await user.click(checkboxes[50]);
  expect(
    within(group).getAllByRole("checkbox", { checked: true }),
  ).toHaveLength(50);
  expect(checkboxes[0]).toBeDisabled();
});
it("allows products without add-ons and renders no modifier controls", async () => {
  vi.mocked(api.get).mockResolvedValue({ data: { ...details, addOns: [] } });
  setup();
  const { dialog } = await openDetails();
  expect(
    within(dialog).queryByRole("group", { name: "Add-ons (optional)" }),
  ).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeEnabled();
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
it.each(["grid", "list", "compact"] as const)(
  "keeps sold-out products visible and described in featured and ordinary %s sections",
  async (layout) => {
    const soldOut = {
      ...product,
      status: "SOLD_OUT" as const,
      isOrderable: false,
      isFeatured: true,
    };
    vi.mocked(api.get).mockResolvedValue({
      data: { ...details, product: soldOut },
    });
    setup({
      ...menu,
      shop: { ...menu.shop, menuLayout: layout },
      products: [soldOut],
      featuredProducts: [soldOut],
    });
    for (const name of ["Featured", "Uncategorized"]) {
      const section = screen.getByRole("region", { name });
      expect(within(section).getByText("Sold out")).toBeInTheDocument();
      expect(
        within(section).getByRole("heading", { name: "Coffee" }),
      ).toBeInTheDocument();
      expect(
        within(section).getByRole("button", {
          name: "View details for Coffee",
        }),
      ).toHaveAccessibleDescription("Sold out");
    }
    await userEvent
      .setup()
      .click(
        within(screen.getByRole("region", { name: "Featured" })).getByRole(
          "button",
          { name: "View details for Coffee" },
        ),
      );
    const dialog = screen.getByRole("dialog", { name: "Coffee" });
    await within(dialog).findByLabelText(/Quantity/);
    expect(
      within(dialog).getByRole("button", { name: "Add to cart" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("checkbox", { name: /Oat milk/ }),
    ).toBeDisabled();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(api.post).not.toHaveBeenCalled();
    expect(useCart.getState().shops).toEqual({});
  },
);
it("blocks sold-out status even if an inconsistent orderable flag is returned", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...details,
      product: { ...product, status: "SOLD_OUT", isOrderable: true },
    },
  });
  setup();
  const { dialog } = await openDetails();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeDisabled();
  fireEvent.submit(dialog.querySelector("form")!);
  expect(api.post).not.toHaveBeenCalled();
});
it("keeps the cart unchanged when an item sells out and refreshes to blocked details", async () => {
  vi.mocked(api.get)
    .mockResolvedValueOnce({ data: details })
    .mockResolvedValueOnce({
      data: {
        ...details,
        product: { ...product, status: "SOLD_OUT", isOrderable: false },
      },
    });
  vi.mocked(api.post).mockRejectedValue(
    new Error("This product is unavailable."),
  );
  setup();
  const { user, dialog } = await openDetails();
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  await within(dialog).findByRole("alert");
  expect(useCart.getState().shops).toEqual({});
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh details" }),
  );
  await within(dialog).findByLabelText(/Quantity/);
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeDisabled();
  expect(within(dialog).getByLabelText(/Quantity/)).toBeDisabled();
  expect(within(dialog).getAllByRole("status")[0]).toHaveTextContent(
    "Sold out",
  );
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(useCart.getState().shops).toEqual({});
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
it("unlocks refreshed details and ignores a quote from the replaced form", async () => {
  let resolveQuote!: (value: unknown) => void;
  vi.mocked(api.post).mockReturnValue(
    new Promise((done) => {
      resolveQuote = done;
    }),
  );
  const view = setup();
  const { user, dialog } = await openDetails();
  await user.click(within(dialog).getByRole("button", { name: "Add to cart" }));
  expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
  vi.mocked(api.get).mockResolvedValue({
    data: { ...details, product: { ...product, price: "125.01" } },
  });
  await act(async () => {
    await view.client.invalidateQueries({
      queryKey: ["public-product", "cafe", product.id],
    });
  });
  await within(dialog).findByLabelText(/Quantity/);
  expect(within(dialog).getByRole("button", { name: "Close" })).toBeEnabled();
  expect(
    within(dialog).getByRole("button", { name: "Add to cart" }),
  ).toBeEnabled();
  await act(async () => resolveQuote({ data: { productId: product.id } }));
  expect(useCart.getState().shops).toEqual({});
  await user.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
it("returns from the empty cart to the menu and restores its trigger focus", async () => {
  setup();
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "View cart (0)" });
  await user.click(trigger);
  const cart = screen.getByRole("dialog", { name: "Cafe cart" });
  expect(
    within(cart).getByRole("heading", { name: "Your cart is empty." }),
  ).toBeInTheDocument();
  expect(within(cart).getByRole("status")).toHaveTextContent("₱0.00");
  await user.click(within(cart).getByRole("button", { name: "Browse menu" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(api.post).not.toHaveBeenCalled();
});
it("removes only this shop's lines, updates the total and keeps focus in the cart", async () => {
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
  useCart
    .getState()
    .add("cafe", {
      ...quote,
      productName: "Tea",
      quantity: 1,
      totalPrice: "120.01",
    });
  useCart.getState().add("other", { ...quote, productName: "Other shop item" });
  setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "View cart (3)" }));
  const cart = screen.getByRole("dialog", { name: "Cafe cart" });
  expect(within(cart).getByRole("status")).toHaveTextContent("₱360.03");
  expect(within(cart).queryByText("Other shop item")).not.toBeInTheDocument();
  await user.click(within(cart).getByRole("button", { name: "Remove Coffee" }));
  expect(within(cart).getByRole("status")).toHaveTextContent("₱120.01");
  expect(
    within(cart).getByRole("button", { name: "Remove Tea" }),
  ).toHaveFocus();
  await user.click(within(cart).getByRole("button", { name: "Remove Tea" }));
  expect(
    within(cart).getByRole("button", { name: "Browse menu" }),
  ).toHaveFocus();
  expect(within(cart).getByRole("status")).toHaveTextContent("₱0.00");
  expect(useCart.getState().shops.other).toHaveLength(1);
  expect(api.post).not.toHaveBeenCalled();
});
