import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  UserMembership,
  AddOn,
  MenuProduct,
  ProductVariantsResponse,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import * as api from "../../features/shops/api/customization";
import { listProducts } from "../../features/shops/api/products";
import { AddOnsPage } from "./AddOnsPage";
import { ProductCustomizationPage } from "./ProductCustomizationPage";
import { useFeedbackStore } from "../../app/stores/feedback";
vi.mock("../../features/shops/api/customization", async (original) => ({
  ...(await original<
    typeof import("../../features/shops/api/customization")
  >()),
  listAddOns: vi.fn(),
  listProductAddOns: vi.fn(),
  listVariants: vi.fn(),
  saveAddOn: vi.fn(),
  saveVariant: vi.fn(),
  deleteVariant: vi.fn(),
  deleteAddOn: vi.fn(),
  saveOptionGroup: vi.fn(),
  assignAddOn: vi.fn(),
  unassignAddOn: vi.fn(),
}));
vi.mock("../../features/shops/api/products", async (original) => ({
  ...(await original<typeof import("../../features/shops/api/products")>()),
  listProducts: vi.fn(),
}));
const addon: AddOn = {
  id: "oat",
  shopId: "a",
  name: "Oat Milk",
  priceAdjustment: "25.20",
  isAvailable: true,
  sortOrder: 0,
  createdAt: "2026-10-11",
  updatedAt: "2026-10-11",
};
const product: MenuProduct = {
  id: "p",
  shopId: "a",
  categoryId: null,
  name: "Latte",
  slug: "latte",
  price: "120.00",
  description: null,
  imageUrl: null,
  status: "AVAILABLE",
  isFeatured: false,
  isArchived: false,
  sortOrder: 0,
  createdAt: "2026-10-11",
};
const options: ProductVariantsResponse = {
  optionGroups: [
    {
      id: "size",
      shopId: "a",
      productId: "p",
      name: "Size",
      isRequired: true,
      isAvailable: true,
      sortOrder: 0,
      createdAt: "2026-10-11",
      updatedAt: "2026-10-11",
    },
  ],
  variants: [
    {
      id: "regular",
      shopId: "a",
      productId: "p",
      optionGroupId: "size",
      name: "Regular",
      priceAdjustment: "0.00",
      isDefault: true,
      isAvailable: true,
      sortOrder: 0,
      createdAt: "2026-10-11",
      updatedAt: "2026-10-11",
    },
  ],
};
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.mocked(api.listAddOns).mockResolvedValue({ addOns: [addon] });
  vi.mocked(api.listProductAddOns).mockResolvedValue({ addOns: [] });
  vi.mocked(api.listVariants).mockResolvedValue(options);
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(api.saveAddOn).mockResolvedValue({ addOn: addon });
  vi.mocked(api.assignAddOn).mockResolvedValue({ addOn: addon });
  vi.mocked(api.saveVariant).mockResolvedValue({
    variant: options.variants[0],
  });
  vi.mocked(api.deleteVariant).mockResolvedValue(undefined);
  vi.mocked(api.deleteAddOn).mockResolvedValue(undefined);
  vi.mocked(api.saveOptionGroup).mockResolvedValue({
    optionGroup: options.optionGroups[0],
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  useFeedbackStore.getState().clear();
});
function setup(
  role: UserMembership["role"] = "OWNER",
  library = false,
  section = "addons",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["auth", "me"], { user: { id: "u" } });
  const membership = {
    id: "m",
    shopId: "a",
    role,
    shop: { id: "a", name: "Cafe", slug: "cafe", isActive: true },
  };
  const tree = (value: UserMembership) => (
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          library ? "/add-ons" : `/products/p/customize?section=${section}`,
        ]}
      >
        <ActiveShopContext.Provider value={value}>
          <Routes>
            <Route path="/add-ons" element={<AddOnsPage />} />
            <Route
              path="/products/:productId/customize"
              element={<ProductCustomizationPage />}
            />
          </Routes>
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(membership));
  return {
    client,
    ...view,
    changeRole: (role: UserMembership["role"]) =>
      view.rerender(tree({ ...membership, role })),
  };
}
it("links to customization sections and explains list position in the editor", async () => {
  setup("OWNER", false, "choices");
  const choices = await screen.findByRole("tab", { name: /Sizes & choices/ });
  expect(choices).toHaveAttribute("aria-selected", "true");
  const addons = screen.getByRole("tab", { name: /Add-ons/ });
  fireEvent.keyDown(choices, { key: "ArrowRight" });
  expect(addons).toHaveFocus();
  expect(addons).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("button", { name: "Create group" })).toBeNull();
  fireEvent.keyDown(addons, { key: "ArrowLeft" });
  await userEvent.click(
    screen.getByRole("button", { name: "Add standalone option" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Create option" });
  await userEvent.click(within(dialog).getByText("More settings"));
  expect(
    within(dialog).getByLabelText("List position"),
  ).toHaveAccessibleDescription(/Lower numbers appear first/);
  expect(
    within(dialog).getByLabelText("Extra charge (PHP)"),
  ).toHaveAccessibleDescription(/Added to the product price/);
});
it("gives the shared add-on library a route back to product setup", async () => {
  setup("OWNER", true);
  await screen.findByRole("button", { name: "Edit Oat Milk" });
  expect(screen.getByRole("link", { name: "Choose products" })).toHaveAttribute(
    "href",
    "/app/shops/a/products",
  );
});
it("adds an option directly to its group without requiring a group selection", async () => {
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Add option to Size" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Create option" });
  expect(
    within(dialog).getByRole("combobox", { name: "Option group" }),
  ).toHaveTextContent("Size");
  await userEvent.type(within(dialog).getByLabelText("Name"), "Large");
  fireEvent.change(within(dialog).getByLabelText("Extra charge (PHP)"), {
    target: { value: "25.00" },
  });
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create option" }),
  );
  await waitFor(() =>
    expect(api.saveVariant).toHaveBeenCalledWith(
      "a",
      "p",
      expect.objectContaining({
        name: "Large",
        optionGroupId: "size",
        priceAdjustment: "25.00",
      }),
      undefined,
    ),
  );
});
it("takes a newly created group straight to adding its first option", async () => {
  const group = {
    ...options.optionGroups[0],
    id: "temperature",
    name: "Temperature",
  };
  vi.mocked(api.saveOptionGroup).mockImplementation(async () => {
    vi.mocked(api.listVariants).mockResolvedValue({
      ...options,
      optionGroups: [...options.optionGroups, group],
    });
    return { optionGroup: group };
  });
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Create group" }),
  );
  let dialog = screen.getByRole("dialog", { name: "Create option group" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "Temperature");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create option group" }),
  );
  dialog = await screen.findByRole("dialog", { name: "Create option" });
  expect(within(dialog).getByLabelText("Name")).toHaveValue("");
  expect(
    within(dialog).getByRole("combobox", { name: "Option group" }),
  ).toHaveTextContent("Temperature");
  await userEvent.type(within(dialog).getByLabelText("Name"), "Iced");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create option" }),
  );
  await waitFor(() =>
    expect(api.saveVariant).toHaveBeenCalledWith(
      "a",
      "p",
      expect.objectContaining({ name: "Iced", optionGroupId: "temperature" }),
      undefined,
    ),
  );
});
it("opens advanced settings and focuses an invalid list position", async () => {
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Add option to Size" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Create option" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "Small");
  const more = within(dialog).getByText("More settings");
  await userEvent.click(more);
  fireEvent.change(within(dialog).getByLabelText("List position"), {
    target: { value: "-1" },
  });
  await userEvent.click(more);
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create option" }),
  );
  expect(more.closest("details")).toHaveAttribute("open");
  expect(within(dialog).getByLabelText("List position")).toHaveFocus();
  expect(api.saveVariant).not.toHaveBeenCalled();
});
it.each(["CASHIER", "KITCHEN"] as const)(
  "blocks %s from direct customization routes and data requests",
  (role) => {
    setup(role);
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
    expect(listProducts).not.toHaveBeenCalled();
    expect(api.listVariants).not.toHaveBeenCalled();
  },
);
it.each(["CASHIER", "KITCHEN"] as const)(
  "blocks %s from the library route",
  (role) => {
    setup(role, true);
    expect(api.listAddOns).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Create add-on" })).toBeNull();
  },
);
it.each(["OWNER", "ADMIN", "MANAGER"] as const)(
  "lets %s assign an eligible shop add-on",
  async (role) => {
    setup(role);
    await userEvent.click(
      await screen.findByRole("checkbox", {
        name: "Offer Oat Milk on this product",
      }),
    );
    await waitFor(() =>
      expect(api.assignAddOn).toHaveBeenCalledWith("a", "p", "oat"),
    );
  },
);
it("removes only the product assignment", async () => {
  vi.mocked(api.listProductAddOns).mockResolvedValue({ addOns: [addon] });
  setup();
  await userEvent.click(
    await screen.findByRole("checkbox", {
      name: "Offer Oat Milk on this product",
    }),
  );
  await waitFor(() =>
    expect(api.unassignAddOn).toHaveBeenCalledWith("a", "p", "oat"),
  );
  expect(api.saveAddOn).not.toHaveBeenCalled();
});
it("creates a free removal as generic data and does not assign automatically", async () => {
  setup();
  await userEvent.click(
    await screen.findByRole("button", { name: "Create add-on" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Create add-on" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "No Onions");
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create add-on" }),
  );
  await waitFor(() =>
    expect(api.saveAddOn).toHaveBeenCalledWith(
      "a",
      {
        name: "No Onions",
        priceAdjustment: "0.00",
        isAvailable: true,
        sortOrder: 0,
      },
      undefined,
    ),
  );
  expect(api.assignAddOn).not.toHaveBeenCalled();
});
it("creates a base option with zero surcharge when default is selected", async () => {
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Add standalone option" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Create option" });
  await userEvent.type(within(dialog).getByLabelText("Name"), "Standard");
  fireEvent.change(within(dialog).getByLabelText("Extra charge (PHP)"), {
    target: { value: "15.50" },
  });
  await userEvent.click(
    within(dialog).getByLabelText("Use as the default option"),
  );
  expect(within(dialog).getByLabelText("Extra charge (PHP)")).toHaveValue(
    "0.00",
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create option" }),
  );
  await waitFor(() =>
    expect(api.saveVariant).toHaveBeenCalledWith(
      "a",
      "p",
      expect.objectContaining({
        name: "Standard",
        priceAdjustment: "0.00",
        isDefault: true,
      }),
      undefined,
    ),
  );
});
it("warns about all products and keeps an add-on when deletion is cancelled", async () => {
  setup("OWNER", true);
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Oat Milk" }),
  );
  const editor = screen.getByRole("dialog", { name: "Edit add-on" });
  await userEvent.click(
    within(editor).getByRole("button", { name: "Delete add-on" }),
  );
  const confirmation = screen.getByRole("dialog", { name: "Delete Oat Milk?" });
  expect(confirmation).toHaveAccessibleDescription(/every product using it/);
  expect(
    within(confirmation).getByRole("button", { name: "Keep add-on" }),
  ).toHaveFocus();
  await userEvent.click(
    within(confirmation).getByRole("button", { name: "Keep add-on" }),
  );
  expect(api.deleteAddOn).not.toHaveBeenCalled();
  expect(within(editor).getByLabelText("Name")).toHaveValue("Oat Milk");
});
it.each([true, false])(
  "deletes a shared add-on from library=%s and refreshes the list",
  async (library) => {
    setup("OWNER", library);
    await userEvent.click(
      await screen.findByRole("button", {
        name: library ? "Edit Oat Milk" : "Edit shared Oat Milk",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Edit add-on" })).getByRole(
        "button",
        { name: "Delete add-on" },
      ),
    );
    vi.mocked(api.listAddOns).mockResolvedValue({ addOns: [] });
    vi.mocked(api.listProductAddOns).mockResolvedValue({ addOns: [] });
    await userEvent.click(
      within(
        screen.getByRole("dialog", { name: "Delete Oat Milk?" }),
      ).getByRole("button", { name: "Delete add-on" }),
    );
    await waitFor(() =>
      expect(api.deleteAddOn).toHaveBeenCalledExactlyOnceWith("a", "oat"),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      screen.queryByRole("button", {
        name: library ? "Edit Oat Milk" : "Edit shared Oat Milk",
      }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Create add-on" })).toHaveFocus();
    expect(api.unassignAddOn).not.toHaveBeenCalled();
  },
);
it("locks add-on deletion after an uncertain result and prevents duplicate confirmation", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.deleteAddOn).mockReturnValue(
    new Promise((_, failure) => {
      reject = failure;
    }),
  );
  setup("OWNER", true);
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Oat Milk" }),
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Edit add-on" })).getByRole(
      "button",
      { name: "Delete add-on" },
    ),
  );
  const confirmation = screen.getByRole("dialog", { name: "Delete Oat Milk?" });
  const confirm = within(confirmation).getByRole("button", {
    name: "Delete add-on",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(api.deleteAddOn).toHaveBeenCalledOnce();
  expect(
    within(confirmation).getByRole("button", { name: "Keep add-on" }),
  ).toBeDisabled();
  reject(new Error("Connection lost"));
  await screen.findByText(
    "We couldn't confirm the save. Refresh before trying again.",
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Delete Oat Milk?" }),
    ).toBeNull(),
  );
  expect(
    within(screen.getByRole("dialog", { name: "Edit add-on" })).getByRole(
      "button",
      { name: "Delete add-on" },
    ),
  ).toBeDisabled();
});
it("does not offer permanent deletion for a new unsaved add-on", async () => {
  setup("OWNER", true);
  await userEvent.click(
    await screen.findByRole("button", { name: "Create add-on" }),
  );
  expect(
    within(screen.getByRole("dialog", { name: "Create add-on" })).queryByRole(
      "button",
      { name: "Delete add-on" },
    ),
  ).toBeNull();
});
it("requires explicit confirmation and preserves the option when cancelled", async () => {
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Regular option" }),
  );
  const editor = screen.getByRole("dialog", { name: "Edit option" });
  await userEvent.click(
    within(editor).getByRole("button", { name: "Delete option" }),
  );
  const confirmation = screen.getByRole("dialog", { name: "Delete Regular?" });
  expect(
    within(confirmation).getByRole("button", { name: "Keep option" }),
  ).toHaveFocus();
  expect(api.deleteVariant).not.toHaveBeenCalled();
  await userEvent.click(
    within(confirmation).getByRole("button", { name: "Keep option" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Edit option" }),
  ).toBeInTheDocument();
  expect(api.deleteVariant).not.toHaveBeenCalled();
});
it("deletes the saved option, refreshes its list and restores useful focus", async () => {
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Regular option" }),
  );
  const editor = screen.getByRole("dialog", { name: "Edit option" });
  await userEvent.type(within(editor).getByLabelText("Name"), " edited draft");
  await userEvent.click(
    within(editor).getByRole("button", { name: "Delete option" }),
  );
  vi.mocked(api.listVariants).mockResolvedValue({ ...options, variants: [] });
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Delete Regular?" })).getByRole(
      "button",
      { name: "Delete option" },
    ),
  );
  await waitFor(() =>
    expect(api.deleteVariant).toHaveBeenCalledExactlyOnceWith(
      "a",
      "p",
      "regular",
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    screen.queryByRole("button", { name: "Edit Regular option" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Add standalone option" }),
  ).toHaveFocus();
  expect(api.saveVariant).not.toHaveBeenCalled();
});
it("keeps failed deletion drafts and displays the backend conflict", async () => {
  vi.mocked(api.deleteVariant).mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 409,
      data: { message: "Add another available option before deleting." },
    },
  });
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Regular option" }),
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Edit option" })).getByRole(
      "button",
      { name: "Delete option" },
    ),
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Delete Regular?" })).getByRole(
      "button",
      { name: "Delete option" },
    ),
  );
  await screen.findByText("Add another available option before deleting.");
  expect(
    screen.getByRole("dialog", { name: "Edit option" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toHaveValue("Regular");
});
it("blocks duplicate deletion and locks retries after an uncertain result", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.deleteVariant).mockReturnValue(
    new Promise((_, failure) => {
      reject = failure;
    }),
  );
  setup("OWNER", false, "choices");
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Regular option" }),
  );
  await userEvent.click(
    within(screen.getByRole("dialog", { name: "Edit option" })).getByRole(
      "button",
      { name: "Delete option" },
    ),
  );
  const confirmation = screen.getByRole("dialog", { name: "Delete Regular?" });
  const confirm = within(confirmation).getByRole("button", {
    name: "Delete option",
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(api.deleteVariant).toHaveBeenCalledOnce();
  expect(
    within(confirmation).getByRole("button", { name: "Keep option" }),
  ).toBeDisabled();
  reject(new Error("Connection lost"));
  await screen.findByText(
    "We couldn't confirm the save. Refresh before trying again.",
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Delete Regular?" }),
    ).toBeNull(),
  );
  expect(
    within(screen.getByRole("dialog", { name: "Edit option" })).getByRole(
      "button",
      { name: "Delete option" },
    ),
  ).toBeDisabled();
});
it("blocks writes after an uncertain save until a successful refresh", async () => {
  vi.mocked(api.assignAddOn).mockRejectedValue(new Error("connection lost"));
  setup();
  const checkbox = await screen.findByRole("checkbox", {
    name: "Offer Oat Milk on this product",
  });
  await userEvent.click(checkbox);
  await screen.findByText(
    "We couldn't confirm the save. Refresh before trying again.",
  );
  expect(checkbox).toBeDisabled();
  vi.mocked(api.assignAddOn).mockResolvedValue({ addOn: addon });
  await userEvent.click(
    screen.getByRole("button", { name: "Refresh customization" }),
  );
  await waitFor(() => expect(checkbox).not.toBeDisabled());
});
it("rejects archived/foreign products without loading customization", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, isArchived: true }],
  });
  setup();
  await screen.findByText(
    "This product is unavailable or archived in this shop.",
  );
  expect(api.listVariants).not.toHaveBeenCalled();
});
it("removes actions after a role change", async () => {
  const view = setup();
  await screen.findByRole("checkbox", {
    name: "Offer Oat Milk on this product",
  });
  view.changeRole("CASHIER");
  expect(screen.getByRole("alert")).toHaveTextContent("permission");
  expect(api.assignAddOn).not.toHaveBeenCalled();
});
it("warns that library edits affect every assigned product", async () => {
  setup("OWNER", true);
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit Oat Milk" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "every product using this add-on",
  );
});
it("renders modifier names as text without creating unsafe elements", async () => {
  vi.mocked(api.listAddOns).mockResolvedValue({
    addOns: [{ ...addon, name: '<img src=x onerror="alert(1)">' }],
  });
  const { container } = setup("OWNER", true);
  await screen.findByText('<img src=x onerror="alert(1)">');
  expect(container.querySelector("img")).toBeNull();
});
it("shows the actual products using a shared add-on", async () => {
  vi.mocked(api.listAddOns).mockResolvedValue({
    addOns: [
      {
        ...addon,
        assignedProducts: [{ id: "p", name: "Latte", isArchived: false }],
      },
    ],
  });
  setup("OWNER", true);
  expect(
    await screen.findByRole("link", { name: "Manage Oat Milk on Latte" }),
  ).toHaveAttribute("href", "/app/shops/a/products/p/customize?section=addons");
});
it("keeps archived product usage as text and expands extra product links", async () => {
  vi.mocked(api.listAddOns).mockResolvedValue({
    addOns: [
      {
        ...addon,
        assignedProducts: [
          { id: "archived", name: "Old Latte", isArchived: true },
          { id: "p2", name: "Americano", isArchived: false },
          { id: "p3", name: "Mocha", isArchived: false },
          { id: "p4", name: "Cappuccino", isArchived: false },
        ],
      },
    ],
  });
  setup("OWNER", true);
  await screen.findByText("Old Latte · archived");
  expect(screen.queryByRole("link", { name: /Old Latte/ })).toBeNull();
  expect(screen.getByText("+1 more").closest("details")).not.toHaveAttribute(
    "open",
  );
  await userEvent.click(screen.getByText("+1 more"));
  expect(screen.getByText("+1 more").closest("details")).toHaveAttribute(
    "open",
  );
  expect(
    screen.getByRole("link", { name: "Manage Oat Milk on Cappuccino" }),
  ).toHaveAttribute(
    "href",
    "/app/shops/a/products/p4/customize?section=addons",
  );
});
it("recovers an empty add-on search without changing menu data", async () => {
  setup("OWNER", true);
  await screen.findByRole("button", { name: "Edit Oat Milk" });
  await userEvent.type(screen.getByLabelText("Search add-ons"), "unknown");
  expect(screen.queryByRole("button", { name: "Edit Oat Milk" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    screen.getByRole("button", { name: "Edit Oat Milk" }),
  ).toBeInTheDocument();
  expect(api.saveAddOn).not.toHaveBeenCalled();
});
it("shows selected extras and navigates from the product to the shared library", async () => {
  vi.mocked(api.listProductAddOns).mockResolvedValue({ addOns: [addon] });
  setup();
  const checkbox = await screen.findByRole("checkbox", {
    name: "Offer Oat Milk on this product",
  });
  expect(checkbox).toBeChecked();
  expect(screen.getByText("Selected")).toBeInTheDocument();
  expect(screen.getByText("1 selected")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Shop add-on library" }),
  ).toHaveAttribute("href", "/app/shops/a/add-ons");
});
it("keeps hidden shop extras explicit and recovers product add-on search", async () => {
  vi.mocked(api.listAddOns).mockResolvedValue({
    addOns: [{ ...addon, isAvailable: false }],
  });
  setup();
  await screen.findByRole("checkbox", {
    name: "Offer Oat Milk on this product",
  });
  expect(screen.getByText("Hidden across the shop")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Find an add-on"), "unknown");
  expect(
    screen.queryByRole("checkbox", { name: "Offer Oat Milk on this product" }),
  ).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    screen.getByRole("checkbox", { name: "Offer Oat Milk on this product" }),
  ).toBeInTheDocument();
  expect(api.assignAddOn).not.toHaveBeenCalled();
});
it("prevents duplicate assignment requests while the first save is pending", async () => {
  let finish!: (value: { addOn: AddOn }) => void;
  vi.mocked(api.assignAddOn).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  setup();
  const checkbox = await screen.findByRole("checkbox", {
    name: "Offer Oat Milk on this product",
  });
  fireEvent.click(checkbox);
  fireEvent.click(checkbox);
  await waitFor(() => expect(api.assignAddOn).toHaveBeenCalledTimes(1));
  expect(checkbox).toBeDisabled();
  finish({ addOn: addon });
  await waitFor(() => expect(checkbox).not.toBeDisabled());
});
it("does not show a late save message after the account changes", async () => {
  let finish!: (value: { addOn: AddOn }) => void;
  vi.mocked(api.assignAddOn).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = setup();
  await userEvent.click(
    await screen.findByRole("checkbox", {
      name: "Offer Oat Milk on this product",
    }),
  );
  view.client.setQueryData(["auth", "me"], { user: { id: "other" } });
  view.unmount();
  finish({ addOn: addon });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useFeedbackStore.getState().notices).toEqual([]);
});
