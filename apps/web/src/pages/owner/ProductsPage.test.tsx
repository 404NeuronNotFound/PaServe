import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { UserMembership, MenuProduct } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import {
  createProduct,
  listProducts,
  productsKey,
  updateProduct,
  setProductArchived,
  uploadProductImage,
  setProductAvailable,
  setProductSoldOut,
  setProductHidden,
  setProductFeatured,
  reorderProducts,
  reorderFeaturedProducts,
} from "../../features/shops/api/products";
import { listCategories } from "../../features/shops/api/categories";
import { useFeedbackStore } from "../../app/stores/feedback";
import { ProductsPage } from "./ProductsPage";
vi.mock("../../features/shops/api/products", async (original) => ({
  ...(await original<typeof import("../../features/shops/api/products")>()),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  setProductArchived: vi.fn(),
  uploadProductImage: vi.fn(),
  setProductAvailable: vi.fn(),
  setProductSoldOut: vi.fn(),
  setProductHidden: vi.fn(),
  setProductFeatured: vi.fn(),
  reorderProducts: vi.fn(),
  reorderFeaturedProducts: vi.fn(),
  listProducts: vi.fn(),
}));
vi.mock("../../features/shops/api/categories", async (original) => ({
  ...(await original<typeof import("../../features/shops/api/categories")>()),
  listCategories: vi.fn(),
}));
const product: MenuProduct = {
  id: "p",
  shopId: "a",
  categoryId: null,
  name: "Latte",
  slug: "latte",
  price: "12.50",
  description: null,
  imageUrl: null,
  status: "AVAILABLE",
  isFeatured: false,
  isArchived: false,
  sortOrder: 0,
  createdAt: "2026-10-09T00:00:00Z",
};
const category = {
  id: "cat-a",
  shopId: "a",
  name: "Coffee",
  slug: "coffee",
  description: null,
  sortOrder: 0,
  isVisible: false,
  createdAt: product.createdAt,
};
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    writable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    writable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
    },
  );
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
    this: HTMLDialogElement,
  ) {
    this.open = false;
  });
  vi.mocked(listProducts).mockResolvedValue({ products: [] });
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  vi.mocked(createProduct).mockResolvedValue({ product });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  useFeedbackStore.getState().clear();
});
function setup(role: UserMembership["role"] = "OWNER") {
  const client = new QueryClient();
  client.setQueryData(["auth", "me"], { user: { id: "user-a" } });
  const membership = {
    id: "member",
    shopId: "a",
    role,
    shop: { id: "a", name: "Cafe A", slug: "cafe-a", isActive: true },
  };
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActiveShopContext.Provider value={membership}>
          <ProductsPage />
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
async function findProductAction(name: string) {
  await screen.findByRole("heading", { name: "Latte" });
  const button = screen.getByRole("button", { name, hidden: true });
  const disclosure = button.closest("details");
  if (disclosure && !disclosure.open)
    await userEvent.click(disclosure.querySelector("summary")!);
  return screen.findByRole("button", { name });
}
it("opens product creation from the first-product empty state", async () => {
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Add your first product" }));
  expect(screen.getByRole("dialog", { name: "Create product" })).toBeInTheDocument();
  expect(createProduct).not.toHaveBeenCalled();
});

it("offers product creation in an empty category and preselects that category", async () => {
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Add product to Coffee" }));
  const modal = within(screen.getByRole("dialog", { name: "Create product" }));
  expect(modal.getByRole("combobox", { name: "Category" })).toHaveTextContent("Coffee (hidden) /coffee");
  expect(screen.getByText(/category will stay hidden/)).toBeInTheDocument();
});

it("clears a no-match product search using its empty-state action", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Latte" });
  await user.type(screen.getByRole("searchbox", { name: "Find a product" }), "missing");
  await user.click(screen.getByRole("button", { name: "Reset product filters" }));
  expect(screen.getByRole("heading", { name: "Latte" })).toBeInTheDocument();
  expect(screen.getByRole("searchbox", { name: "Find a product" })).toHaveValue("");
  await waitFor(() => expect(screen.getByRole("searchbox", { name: "Find a product" })).toHaveFocus());
});
it.each([
  ["Hide Latte", setProductHidden, "HIDDEN"],
  ["Mark Latte sold out", setProductSoldOut, "SOLD_OUT"],
  ["Make Latte available", setProductAvailable, "AVAILABLE"],
] as const)("previews %s immediately and rolls back a rejected status", async (label, write, target) => {
  const saved = { ...product, status: target === "AVAILABLE" ? "SOLD_OUT" as const : "AVAILABLE" as const };
  vi.mocked(listProducts).mockResolvedValue({ products: [saved] });
  let reject!: (reason: unknown) => void;
  vi.mocked(write).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const { client } = setup();
  await userEvent.click(await findProductAction(label));
  expect(screen.getByText("Saving product status…")).toBeInTheDocument();
  if (target === "HIDDEN") expect(screen.getByText("Hidden from the customer menu · Details kept")).toBeInTheDocument();
  if (target === "SOLD_OUT") expect(screen.getByText("Temporarily unavailable")).toBeInTheDocument();
  if (target === "AVAILABLE") expect(screen.getByText("Shown on the menu · Available to order")).toBeInTheDocument();
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({ products: [saved] });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
  await act(async () => reject({ isAxiosError: true, response: { status: 409 } }));
  expect(screen.getByRole("alert")).toHaveTextContent("preview was reverted");
  expect(await findProductAction(label)).toBeEnabled();
});

it("previews featured state without publishing it and accepts the server response", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(setProductFeatured).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const { client } = setup();
  const publicMenu = { products: [], featuredProducts: [] };
  client.setQueryData(["public-menu", "cafe-a"], publicMenu);
  await userEvent.click(await findProductAction("Feature Latte"));
  expect(screen.getByText("Featured", { selector: ".product-featured-badge" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Unfeature Latte", hidden: true })).toHaveAttribute("aria-pressed", "true");
  expect(client.getQueryData(["public-menu", "cafe-a"])).toEqual(publicMenu);
  const saved = { ...product, isFeatured: true, name: "Server Latte" };
  vi.mocked(listProducts).mockResolvedValue({ products: [saved] });
  await act(async () => resolve({ product: saved }));
  expect(await screen.findByRole("heading", { name: "Server Latte" })).toBeInTheDocument();
  expect(screen.queryByText("Saving featured selection…")).not.toBeInTheDocument();
});

it("keeps a pending status row visible under its original status filter", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let reject!: (reason: unknown) => void;
  vi.mocked(setProductHidden).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Latte" });
  await user.click(screen.getByRole("combobox", { name: "Status" }));
  await user.click(screen.getByRole("option", { name: "Available" }));
  await user.click(await findProductAction("Hide Latte"));
  expect(screen.getByRole("heading", { name: "Latte" })).toBeInTheDocument();
  await act(async () => reject(new Error("Rejected")));
  expect(screen.getByRole("heading", { name: "Latte" })).toBeInTheDocument();
});

it("rolls back a featured preview without losing newer product data", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let reject!: (reason: unknown) => void;
  vi.mocked(setProductFeatured).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const { client } = setup();
  await userEvent.click(await findProductAction("Feature Latte"));
  expect(screen.getByText("Featured", { selector: ".product-featured-badge" })).toBeInTheDocument();
  act(() => client.setQueryData(productsKey("user-a", "a"), {
    products: [{ ...product, price: "20.00" }],
  }));
  vi.mocked(listProducts).mockResolvedValue({ products: [{ ...product, price: "20.00" }] });
  await act(async () => reject({ isAxiosError: true }));
  expect(screen.queryByText("Featured", { selector: ".product-featured-badge" })).not.toBeInTheDocument();
  expect(screen.getByText("₱20.00")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("Latest saved products are now loaded");
  expect(await findProductAction("Feature Latte")).toBeEnabled();
});

it.each(["status", "featured"] as const)("reconciles a committed %s change after a lost response without replaying it", async (kind) => {
  const saved = { ...product, status: "SOLD_OUT" as const, isFeatured: true };
  vi.mocked(listProducts).mockResolvedValueOnce({ products: [product] });
  let resolve!: (value: { products: MenuProduct[] }) => void;
  vi.mocked(listProducts).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const write = kind === "status" ? setProductSoldOut : setProductFeatured;
  vi.mocked(write).mockRejectedValueOnce({ isAxiosError: true });
  const { client } = setup();
  client.setQueryData(["public-menu", "cafe-a"], { products: [product] });
  await userEvent.click(await findProductAction(kind === "status" ? "Mark Latte sold out" : "Feature Latte"));
  await screen.findByText(/Checking saved products/);
  expect(screen.queryByRole("heading", { name: "Latte" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create product" })).toBeDisabled();
  await act(async () => resolve({ products: [saved] }));
  expect(await screen.findByRole("heading", { name: "Latte" })).toBeInTheDocument();
  expect(screen.getByText("Sold out", { selector: ".category-visibility" })).toBeInTheDocument();
  expect(screen.getByText("Featured", { selector: ".product-featured-badge" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit Latte" })).toBeEnabled();
  expect(write).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(["public-menu", "cafe-a"])?.isInvalidated).toBe(true);
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("keeps products locked after failed reconciliation until a manual read succeeds", async () => {
  vi.mocked(listProducts).mockResolvedValueOnce({ products: [product] }).mockRejectedValue(new Error("Offline"));
  vi.mocked(setProductFeatured).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Feature Latte"));
  await screen.findByText(/Saved product status is unverified/);
  expect(screen.queryByRole("heading", { name: "Latte" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create product" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh products" }));
  await screen.findByText(/Saved product status is unverified/);
  expect(screen.getByRole("button", { name: "Create product" })).toBeDisabled();
  vi.mocked(listProducts).mockResolvedValue({ products: [{ ...product, isFeatured: true }] });
  await user.click(screen.getByRole("button", { name: "Refresh products" }));
  expect(await screen.findByRole("button", { name: "Edit Latte" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Create product" })).toBeEnabled();
  expect(setProductFeatured).toHaveBeenCalledTimes(1);
});

it("does not accept cached products as verification when the recovery read is cancelled", async () => {
  vi.mocked(listProducts).mockResolvedValueOnce({ products: [product] });
  let resolve!: (value: { products: MenuProduct[] }) => void;
  vi.mocked(listProducts).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  vi.mocked(setProductFeatured).mockRejectedValueOnce({ isAxiosError: true });
  const { client } = setup();
  await userEvent.click(await findProductAction("Feature Latte"));
  await screen.findByText(/Checking saved products/);
  await act(async () => { await client.cancelQueries({ queryKey: productsKey("user-a", "a") }); });
  await screen.findByText(/Saved product status is unverified/);
  await act(async () => resolve({ products: [product] }));
  expect(screen.getByRole("button", { name: "Create product" })).toBeDisabled();
  expect(screen.queryByRole("heading", { name: "Latte" })).not.toBeInTheDocument();
  vi.mocked(listProducts).mockResolvedValue({ products: [{ ...product, isFeatured: true }] });
  await userEvent.click(screen.getByRole("button", { name: "Refresh products" }));
  expect(await screen.findByRole("button", { name: "Edit Latte" })).toBeEnabled();
});
async function open() {
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Create product" }),
  );
  return {
    user,
    modal: within(screen.getByRole("dialog", { name: "Create product" })),
  };
}
async function basics() {
  const state = await open();
  await state.user.type(state.modal.getByLabelText("Product name"), "Latte");
  await state.user.type(state.modal.getByLabelText("Price"), "12.50");
  return state;
}
async function edit() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Latte" }));
  return {
    user,
    modal: within(screen.getByRole("dialog", { name: "Edit product" })),
  };
}
it("keeps secondary actions behind More and supports keyboard and outside dismissal", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  setup();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Edit Latte" });
  const more = screen.getByLabelText("More actions for Latte");
  const disclosure = more.closest("details")!;
  expect(disclosure.open).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Feature Latte" }),
  ).not.toBeInTheDocument();
  more.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("button", { name: "Customize Latte" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("button", { name: "Archive Latte" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(disclosure.open).toBe(false);
  expect(more).toHaveFocus();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("button", { name: "Archive Latte" })).toHaveFocus();
  await user.click(screen.getByRole("heading", { name: "Your menu" }));
  expect(disclosure.open).toBe(false);
});
it("prevents opening another product's actions during a pending save", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [product, { ...product, id: "second", name: "Mocha" }],
  });
  vi.mocked(setProductFeatured).mockReturnValue(new Promise(() => {}));
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Feature Latte"));
  const more = screen.getByLabelText("More actions for Mocha");
  expect(more).toHaveAttribute("aria-disabled", "true");
  await user.click(more);
  expect(more.closest("details")).not.toHaveAttribute("open");
});
it("groups products by category and opens reorder for that category only", async () => {
  const coffee = {
    ...product,
    id: "coffee",
    name: "Americano",
    slug: "americano",
    categoryId: category.id,
  };
  const mocha = { ...coffee, id: "mocha", name: "Mocha", sortOrder: 1 };
  vi.mocked(listProducts).mockResolvedValue({
    products: [product, coffee, mocha],
  });
  setup();
  const user = userEvent.setup();
  const group = within(await screen.findByRole("region", { name: "Coffee" }));
  expect(group.getByRole("heading", { name: "Americano" })).toBeInTheDocument();
  expect(
    group.queryByRole("heading", { name: "Latte" }),
  ).not.toBeInTheDocument();
  expect(group.getByText("Category hidden")).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Uncategorized" })).getByRole(
      "heading",
      { name: "Latte" },
    ),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Product group")).not.toBeInTheDocument();
  const trigger = group.getByRole("button", {
    name: "Reorder Coffee products",
  });
  await user.click(trigger);
  const modal = within(
    screen.getByRole("dialog", { name: "Reorder products" }),
  );
  expect(modal.getByText("Americano")).toBeInTheDocument();
  expect(modal.queryByText("Latte")).not.toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("paginates a large menu and resets pagination when searching", async () => {
  const products = Array.from({ length: 17 }, (_, index) => ({
    ...product,
    id: `p-${index}`,
    name: `Drink ${index}`,
    slug: `drink-${index}`,
    sortOrder: index,
  }));
  vi.mocked(listProducts).mockResolvedValue({ products });
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Drink 0" });
  expect(
    screen.queryByRole("heading", { name: "Drink 8" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Showing 1–8 of 17 products")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Go to product page 2" }),
  );
  expect(
    screen.getByRole("button", { name: "Go to product page 2" }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("heading", { name: "Your menu" })).toHaveFocus();
  expect(screen.getByRole("heading", { name: "Drink 8" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Drink 0" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next product page" }));
  expect(screen.getByRole("heading", { name: "Drink 16" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Next product page" }),
  ).toBeDisabled();
  await user.type(screen.getByLabelText("Find a product"), "Drink 0");
  expect(screen.getByText("Showing 1–1 of 1 products")).toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "Product pages" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Drink 0" })).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Reorder Uncategorized products" }),
  );
  const modal = within(
    screen.getByRole("dialog", { name: "Reorder products" }),
  );
  expect(modal.getAllByRole("listitem")).toHaveLength(17);
  expect(modal.getByText("Drink 16")).toBeInTheDocument();
});
it("combines category and status filters and recovers from no matches", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [
      product,
      { ...product, id: "coffee", categoryId: category.id, name: "Americano" },
      {
        ...product,
        id: "mocha",
        categoryId: category.id,
        name: "Mocha",
        slug: "mocha",
        status: "SOLD_OUT",
      },
    ],
  });
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Latte" });
  await user.click(screen.getByLabelText("Category"));
  await user.click(screen.getByRole("option", { name: "Coffee" }));
  expect(
    screen.queryByRole("region", { name: "Uncategorized" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("Status"));
  await user.click(screen.getByRole("option", { name: "Sold out" }));
  expect(screen.getByRole("heading", { name: "Mocha" })).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Americano" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Find a product"), "Latte");
  expect(
    screen.getByRole("heading", { name: "No products found." }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("heading", { name: "Latte" })).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Americano" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Mocha" })).toBeInTheDocument();
});
it("supports keyboard selection and closes the dropdown with Escape without closing the product modal", async () => {
  setup();
  const { user, modal } = await basics();
  const status = modal.getByRole("combobox", { name: "Menu status" });
  status.focus();
  await user.keyboard("{ArrowDown}{End}{Enter}");
  expect(status).toHaveTextContent("Hidden");
  expect(status).toHaveAttribute("aria-expanded", "false");
  const categoryTrigger = modal.getByRole("combobox", { name: "Category" });
  await user.click(categoryTrigger);
  await user.keyboard("co");
  const option = modal.getByRole("option", { name: /Coffee/ });
  expect(categoryTrigger).toHaveAttribute("aria-activedescendant", option.id);
  await user.keyboard("{Escape}");
  expect(categoryTrigger).toHaveAttribute("aria-expanded", "false");
  expect(categoryTrigger).toHaveTextContent("Uncategorized");
  expect(
    screen.getByRole("dialog", { name: "Create product" }),
  ).toBeInTheDocument();
  expect(categoryTrigger).toHaveFocus();
  await user.click(categoryTrigger);
  await user.click(modal.getByLabelText("Product name"));
  expect(categoryTrigger).toHaveAttribute("aria-expanded", "false");
});
it("saves product moves in one selected group and preserves other products", async () => {
  const second: MenuProduct = {
    ...product,
    id: "second",
    name: "Mocha",
    slug: "mocha",
    sortOrder: 1,
    status: "HIDDEN",
  };
  const other = {
    ...product,
    id: "other",
    name: "Other",
    categoryId: category.id,
  };
  vi.mocked(listProducts).mockResolvedValue({
    products: [product, second, other],
  });
  vi.mocked(reorderProducts).mockResolvedValue({
    products: [
      { ...second, sortOrder: 0 },
      { ...product, sortOrder: 1 },
    ],
  });
  const { client } = setup();
  const publicKey = ["public-menu", "cafe-a"];
  client.setQueryData(publicKey, {
    products: [product, other],
    featuredProducts: [],
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Reorder Uncategorized products",
    }),
  );
  const modal = within(
    screen.getByRole("dialog", { name: "Reorder products" }),
  );
  expect(modal.queryByText("Other")).not.toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Move Mocha up" }));
  vi.mocked(listProducts).mockResolvedValue({
    products: [
      { ...second, sortOrder: 0 },
      other,
      { ...product, sortOrder: 1 },
    ],
  });
  await user.click(modal.getByRole("button", { name: "Save order" }));
  await waitFor(() =>
    expect(reorderProducts).toHaveBeenCalledWith("a", {
      categoryId: null,
      productIds: ["second", "p"],
      expectedOrder: ["p", "second"],
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    (
      client.getQueryData(productsKey("user-a", "a")) as {
        products: MenuProduct[];
      }
    ).products,
  ).toContainEqual(other);
  expect(client.getQueryData(publicKey)).toEqual({
    products: [{ ...product, sortOrder: 1 }, other],
    featuredProducts: [],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: publicKey });
});
it("preserves a dirty product-order draft on conflict and protects cancellation", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [
      product,
      { ...product, id: "second", name: "Mocha", slug: "mocha", sortOrder: 1 },
    ],
  });
  vi.mocked(reorderProducts).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Reorder Uncategorized products",
    }),
  );
  const modal = within(
    screen.getByRole("dialog", { name: "Reorder products" }),
  );
  await user.click(modal.getByRole("button", { name: "Move Mocha up" }));
  await user.click(modal.getByRole("button", { name: "Save order" }));
  expect(
    await modal.findByText(/Products or their order changed/),
  ).toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Cancel" }));
  expect(
    screen.getByRole("dialog", { name: "Discard this product order?" }),
  ).toBeInTheDocument();
});
it("arranges the complete featured selection across categories despite active filters", async () => {
  const a = { ...product, isFeatured: true, featuredSortOrder: 0 };
  const b = {
    ...product,
    id: "b",
    name: "Mocha",
    slug: "mocha",
    categoryId: category.id,
    status: "HIDDEN" as const,
    isFeatured: true,
    featuredSortOrder: 1,
  };
  const archived = { ...b, id: "archived", name: "Archived", isArchived: true };
  vi.mocked(listProducts).mockResolvedValue({ products: [a, b, archived] });
  vi.mocked(reorderFeaturedProducts).mockResolvedValue({
    products: [
      { ...b, featuredSortOrder: 0 },
      { ...a, featuredSortOrder: 1 },
    ],
  });
  const { client } = setup();
  const publicKey = ["public-menu", "cafe-a"];
  client.setQueryData(publicKey, { products: [a], featuredProducts: [a] });
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Reorder featured items" });
  await user.type(screen.getByLabelText("Find a product"), "Latte");
  await user.click(
    screen.getByRole("button", { name: "Reorder featured items" }),
  );
  const modal = within(
    screen.getByRole("dialog", { name: "Reorder featured items" }),
  );
  expect(modal.getByText("Mocha")).toBeInTheDocument();
  expect(modal.queryByText("Archived")).not.toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Move Mocha up" }));
  await user.click(modal.getByRole("button", { name: "Save order" }));
  await waitFor(() =>
    expect(reorderFeaturedProducts).toHaveBeenCalledWith("a", {
      productIds: ["b", "p"],
      expectedOrder: ["p", "b"],
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(reorderProducts).not.toHaveBeenCalled();
  expect(client.getQueryData(publicKey)).toEqual({
    products: [{ ...a, featuredSortOrder: 1 }],
    featuredProducts: [{ ...a, featuredSortOrder: 1 }],
  });
});
it("keeps the featured-order draft on a stale save", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [
      { ...product, isFeatured: true },
      {
        ...product,
        id: "b",
        name: "Mocha",
        isFeatured: true,
        featuredSortOrder: 1,
      },
    ],
  });
  vi.mocked(reorderFeaturedProducts).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Reorder featured items" }),
  );
  const modal = within(
    screen.getByRole("dialog", { name: "Reorder featured items" }),
  );
  await user.click(modal.getByRole("button", { name: "Move Mocha up" }));
  await user.click(modal.getByRole("button", { name: "Save order" }));
  expect(
    await modal.findByText(/Products or their order changed/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Reorder featured items" }),
  ).toBeInTheDocument();
});
it("features and unfeatures a product while preserving menu status", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  const saved = { ...product, isFeatured: true };
  vi.mocked(setProductFeatured)
    .mockResolvedValueOnce({ product: saved })
    .mockResolvedValueOnce({ product });
  const { client } = setup();
  const user = userEvent.setup();
  const trigger = await findProductAction("Feature Latte");
  vi.mocked(listProducts).mockResolvedValue({ products: [saved] });
  await user.click(trigger);
  const undo = await findProductAction("Unfeature Latte");
  expect(undo).toHaveAttribute("aria-pressed", "true");
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [saved],
  });
  expect(setProductFeatured).toHaveBeenCalledWith("a", "p", {
    isFeatured: true,
    expectedFeatured: false,
  });
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  await user.click(undo);
  expect(await findProductAction("Feature Latte")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  expect(setProductFeatured).toHaveBeenLastCalledWith("a", "p", {
    isFeatured: false,
    expectedFeatured: true,
  });
});
it("retains the feature state on conflict and explains recovery inline", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(setProductFeatured).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Feature Latte"));
  expect(
    await screen.findByText(/Featured selection changed elsewhere/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Feature Latte", hidden: true }),
  ).toBeEnabled();
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("prevents duplicate featured changes and ignores late results", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(setProductFeatured).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const user = userEvent.setup();
  await user.dblClick(await findProductAction("Feature Latte"));
  expect(setProductFeatured).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Edit Latte" })).toBeDisabled();
  unmount();
  resolve({ product: { ...product, isFeatured: true } });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [product],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("hides a product without deleting its card and keeps Edit and Make available", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  const saved: MenuProduct = { ...product, status: "HIDDEN" };
  vi.mocked(setProductHidden).mockResolvedValue({ product: saved });
  const { client } = setup();
  const user = userEvent.setup();
  const trigger = await findProductAction("Hide Latte");
  vi.mocked(listProducts).mockResolvedValue({ products: [saved] });
  await user.click(trigger);
  await waitFor(() =>
    expect(setProductHidden).toHaveBeenCalledWith("a", "p", {
      expectedStatus: "AVAILABLE",
    }),
  );
  expect(
    await screen.findByText("Hidden from the customer menu · Details kept"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Make Latte available", hidden: true }),
  ).toBeEnabled();
  expect(screen.getByRole("button", { name: "Edit Latte" })).toBeEnabled();
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [saved],
  });
  expect(useFeedbackStore.getState().notices[0].message).toContain(
    "hidden from the menu",
  );
});
it("keeps hide failures inline without changing the product", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(setProductHidden).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Hide Latte"));
  expect(
    await screen.findByText(/Product status changed elsewhere/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Hide Latte", hidden: true }),
  ).toBeEnabled();
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("blocks duplicate hide actions and ignores a late save", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(setProductHidden).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const user = userEvent.setup();
  await user.dblClick(await findProductAction("Hide Latte"));
  expect(setProductHidden).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Edit Latte" })).toBeDisabled();
  unmount();
  resolve({ product: { ...product, status: "HIDDEN" } });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [product],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("marks a product sold out and offers Make available without a confirmation", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  const saved: MenuProduct = { ...product, status: "SOLD_OUT" };
  vi.mocked(setProductSoldOut).mockResolvedValue({ product: saved });
  setup();
  const user = userEvent.setup();
  const trigger = await findProductAction("Mark Latte sold out");
  vi.mocked(listProducts).mockResolvedValue({ products: [saved] });
  await user.click(trigger);
  await waitFor(() =>
    expect(setProductSoldOut).toHaveBeenCalledWith("a", "p", {
      expectedStatus: "AVAILABLE",
    }),
  );
  expect(await findProductAction("Make Latte available")).toBeEnabled();
  expect(screen.getByText("Temporarily unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(useFeedbackStore.getState().notices[0].message).toContain(
    "is sold out",
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit Latte" })).toHaveFocus(),
  );
});
it("preserves status and explains sold out conflicts inline", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(setProductSoldOut).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Mark Latte sold out"));
  expect(
    await screen.findByText(/Product status changed elsewhere/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Mark Latte sold out", hidden: true }),
  ).toBeEnabled();
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("blocks duplicate sold out actions and ignores completion after unmount", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(setProductSoldOut).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const user = userEvent.setup();
  const button = await findProductAction("Mark Latte sold out");
  await user.dblClick(button);
  expect(setProductSoldOut).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Edit Latte" })).toBeDisabled();
  unmount();
  resolve({ product: { ...product, status: "SOLD_OUT" } });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [product],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("makes a sold-out product available with inline category context and a toast", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, status: "SOLD_OUT", categoryId: category.id }],
  });
  const saved = { ...product, categoryId: category.id };
  vi.mocked(setProductAvailable).mockResolvedValue({ product: saved });
  setup();
  const user = userEvent.setup();
  const trigger = await findProductAction("Make Latte available");
  vi.mocked(listProducts).mockResolvedValue({ products: [saved] });
  await user.click(trigger);
  await waitFor(() =>
    expect(setProductAvailable).toHaveBeenCalledWith("a", "p", {
      expectedStatus: "SOLD_OUT",
    }),
  );
  expect(
    await screen.findByText("Category hidden · Not shown on the menu"),
  ).toBeInTheDocument();
  expect(useFeedbackStore.getState().notices[0].message).toContain(
    "category is still hidden",
  );
});
it("keeps the product unchanged when availability conflicts", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, status: "SOLD_OUT" }],
  });
  vi.mocked(setProductAvailable).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Make Latte available"));
  expect(
    await screen.findByText(/Product status changed elsewhere/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Make Latte available", hidden: true }),
  ).toBeEnabled();
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("blocks other actions while availability is pending and ignores late responses", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, status: "SOLD_OUT" }],
  });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(setProductAvailable).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Make Latte available"));
  expect(screen.getByRole("button", { name: "Edit Latte" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Create product" })).toBeDisabled();
  unmount();
  resolve({ product });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [{ ...product, status: "SOLD_OUT" }],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("shows PHP prices consistently in cards and the edit preview", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, price: "1234.56" }],
  });
  setup();
  expect(await screen.findByText("₱1,234.56")).toBeInTheDocument();
  const { user, modal } = await edit();
  expect(modal.getByText("₱1,234.56")).toBeInTheDocument();
  const input = modal.getByLabelText("Price");
  await user.clear(input);
  await user.type(input, "0.01");
  expect(modal.getByText("₱0.01")).toBeInTheDocument();
  await user.clear(input);
  await user.type(input, "0");
  expect(modal.getByText("₱0.00")).toBeInTheDocument();
});
it("uploads an image immediately while keeping other edits unsaved", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  const imageProduct = {
    ...product,
    imageUrl: "https://example.com/upload.webp",
  };
  vi.mocked(uploadProductImage).mockResolvedValue({
    product: imageProduct,
    storagePath: "a/p/upload.webp",
  });
  vi.mocked(updateProduct).mockResolvedValue({
    product: { ...imageProduct, name: "Latte changed" },
  });
  const { client } = setup();
  const { user, modal } = await edit();
  await user.type(modal.getByLabelText("Product name"), " changed");
  await user.click(modal.getByText("Image & display options"));
  const file = new File(["image bytes"], "photo.png", { type: "image/png" });
  await user.upload(modal.getByLabelText(/Photo.*optional/), file);
  vi.mocked(listProducts).mockResolvedValue({ products: [imageProduct] });
  await user.click(modal.getByRole("button", { name: "Upload image" }));
  await waitFor(() =>
    expect(uploadProductImage).toHaveBeenCalledWith(
      "a",
      "p",
      file,
      expect.any(Function),
    ),
  );
  expect(modal.getByLabelText(/Saved photo/)).toHaveValue(
    imageProduct.imageUrl,
  );
  expect(modal.getByLabelText("Product name")).toHaveValue("Latte changed");
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [imageProduct],
  });
  expect(useFeedbackStore.getState().notices[0].message).toContain(
    "image uploaded",
  );
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateProduct).toHaveBeenCalledWith("a", "p", {
      name: "Latte changed",
    }),
  );
});
it("validates file size and type before uploading", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  setup();
  const { modal } = await edit();
  fireEvent.click(modal.getByText("Image & display options"));
  fireEvent.change(modal.getByLabelText(/Photo.*optional/), {
    target: {
      files: [new File(["svg"], "bad.svg", { type: "image/svg+xml" })],
    },
  });
  expect(
    modal.getByText("Choose a JPEG, PNG or WebP image."),
  ).toBeInTheDocument();
  fireEvent.change(modal.getByLabelText(/Photo.*optional/), {
    target: {
      files: [
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", {
          type: "image/png",
        }),
      ],
    },
  });
  expect(modal.getByText(/between 1 byte and 5 MB/)).toBeInTheDocument();
  expect(uploadProductImage).not.toHaveBeenCalled();
});
it("keeps the previous image and selected file on upload failure", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, imageUrl: "https://example.com/old.webp" }],
  });
  vi.mocked(uploadProductImage).mockRejectedValue({
    isAxiosError: true,
    response: { status: 503, data: { code: "PRODUCT_STORAGE_UNAVAILABLE" } },
  });
  setup();
  const { user, modal } = await edit();
  await user.click(modal.getByText("Image & display options"));
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["png"], "a.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Upload image" }));
  expect(
    await modal.findByText(/Your current image is kept/),
  ).toBeInTheDocument();
  expect(modal.getByLabelText(/Saved photo/)).toHaveValue(
    "https://example.com/old.webp",
  );
  expect(modal.getByRole("button", { name: "Upload image" })).toBeEnabled();
  expect(uploadProductImage).toHaveBeenCalledTimes(1);
});
it("blocks closing while uploading and ignores completion after unmount", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct; storagePath: string }) => void;
  vi.mocked(uploadProductImage).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const { user, modal } = await edit();
  await user.click(modal.getByText("Image & display options"));
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["png"], "a.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Upload image" }));
  expect(modal.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(
    modal.getByRole("button", { name: "Close product form" }),
  ).toBeDisabled();
  unmount();
  resolve({
    product: { ...product, imageUrl: "https://example.com/late.webp" },
    storagePath: "a/p/late.webp",
  });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [product],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("confirms archival, retains the product in the archive and offers Undo", async () => {
  const archived = { ...product, isArchived: true };
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(setProductArchived)
    .mockResolvedValueOnce({ product: archived })
    .mockResolvedValueOnce({ product });
  const { client } = setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Archive Latte"));
  const modal = within(screen.getByRole("dialog", { name: "Archive Latte?" }));
  expect(modal.getByRole("button", { name: "Keep product" })).toHaveFocus();
  expect(setProductArchived).not.toHaveBeenCalled();
  vi.mocked(listProducts).mockResolvedValue({ products: [archived] });
  await user.click(modal.getByRole("button", { name: "Archive product" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(setProductArchived).toHaveBeenCalledWith("a", "p", {
    isArchived: true,
    expectedArchived: false,
  });
  expect(
    screen.queryByRole("button", { name: "Edit Latte" }),
  ).not.toBeInTheDocument();
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [archived],
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Active products/ }),
    ).toHaveFocus(),
  );
  const notice = useFeedbackStore.getState().notices[0];
  expect(notice.kind).toBe("snackbar");
  if (notice.kind !== "snackbar") throw new Error("Missing Undo");
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  await notice.action.onClick();
  expect(setProductArchived).toHaveBeenLastCalledWith("a", "p", {
    isArchived: false,
    expectedArchived: true,
  });
  expect(
    await screen.findByRole("button", { name: "Edit Latte" }),
  ).toBeInTheDocument();
});
it("lets the user view and restore archived products without changing menu status", async () => {
  const hidden = { ...product, isArchived: true, status: "HIDDEN" as const };
  vi.mocked(listProducts).mockResolvedValue({ products: [hidden] });
  vi.mocked(setProductArchived).mockResolvedValue({
    product: { ...hidden, isArchived: false },
  });
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: /Archived products/ }),
  );
  expect(screen.getByText("Archived")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit Latte" }),
  ).not.toBeInTheDocument();
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...hidden, isArchived: false }],
  });
  await user.click(screen.getByRole("button", { name: "Restore Latte" }));
  await screen.findByRole("heading", { name: "Nothing archived." });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: /Archived products/ }),
    ).toHaveFocus(),
  );
  await user.click(
    screen.getByRole("button", { name: "Back to active products" }),
  );
  expect(
    await screen.findByText("Hidden", { selector: ".category-visibility" }),
  ).toBeInTheDocument();
  expect(setProductArchived).toHaveBeenCalledWith("a", "p", {
    isArchived: false,
    expectedArchived: true,
  });
  expect(useFeedbackStore.getState().notices[0].kind).toBe("toast");
});
it("does not archive when the safe choice is used", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Archive Latte"));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep product",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(setProductArchived).not.toHaveBeenCalled();
  expect(
    screen.getByText("More", { selector: "summary span" }).closest("summary"),
  ).toHaveFocus();
});
it("retains the confirmation with inline feedback for stale or uncertain requests", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(setProductArchived).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Archive Latte"));
  const modal = within(screen.getByRole("dialog"));
  await user.click(modal.getByRole("button", { name: "Archive product" }));
  expect(
    await modal.findByText(/Archive status changed elsewhere/),
  ).toBeInTheDocument();
  expect(setProductArchived).toHaveBeenCalledTimes(1);
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
  vi.mocked(setProductArchived).mockRejectedValue({ isAxiosError: true });
  await user.click(modal.getByRole("button", { name: "Archive product" }));
  expect(await modal.findByText(/confirm the change/)).toBeInTheDocument();
  expect(setProductArchived).toHaveBeenCalledTimes(2);
});
it("blocks duplicate archive actions and ignores late completion after leaving the shop", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(setProductArchived).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Archive Latte"));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Archive product",
    }),
  );
  expect(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep product",
    }),
  ).toBeDisabled();
  expect(setProductArchived).toHaveBeenCalledTimes(1);
  unmount();
  resolve({ product: { ...product, isArchived: true } });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [product],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("invalidates an Undo callback when the user leaves the shop page", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  const archived = { ...product, isArchived: true };
  vi.mocked(setProductArchived).mockResolvedValue({ product: archived });
  const { unmount } = setup();
  const user = userEvent.setup();
  await user.click(await findProductAction("Archive Latte"));
  vi.mocked(listProducts).mockResolvedValue({ products: [archived] });
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Archive product",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  const notice = useFeedbackStore.getState().notices[0];
  if (notice.kind !== "snackbar") throw new Error("Missing Undo");
  unmount();
  await expect(notice.action.onClick()).rejects.toThrow(/Return to this shop/);
  expect(setProductArchived).toHaveBeenCalledTimes(1);
});
it("prefills editing and sends only changed fields, preserving the menu address", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  const updated = { ...product, name: "Iced latte", price: "15.75" };
  vi.mocked(updateProduct).mockResolvedValue({ product: updated });
  setup();
  const { user, modal } = await edit();
  expect(modal.getByLabelText("Product name")).toHaveValue("Latte");
  expect(modal.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(modal.getByText(/Renaming keeps this address/)).toHaveTextContent(
    "/latte",
  );
  await user.clear(modal.getByLabelText("Product name"));
  await user.type(modal.getByLabelText("Product name"), "Iced latte");
  await user.clear(modal.getByLabelText("Price"));
  await user.type(modal.getByLabelText("Price"), "15.75");
  vi.mocked(listProducts).mockResolvedValue({ products: [updated] });
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateProduct).toHaveBeenCalledWith("a", "p", {
      name: "Iced latte",
      price: "15.75",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByRole("button", { name: "Edit Iced latte" }),
  ).toHaveFocus();
  expect(useFeedbackStore.getState().notices[0].message).toContain("updated");
  expect(createProduct).not.toHaveBeenCalled();
});
it("allows removing a category explicitly without clearing other fields", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, categoryId: category.id }],
  });
  vi.mocked(updateProduct).mockResolvedValue({ product });
  setup();
  const { user, modal } = await edit();
  await user.click(modal.getByLabelText("Category"));
  await modal.findByRole("option", { name: /Coffee/ });
  await user.click(modal.getByRole("option", { name: "Uncategorized" }));
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateProduct).toHaveBeenCalledWith("a", "p", { categoryId: null }),
  );
});
it("keeps a draft on failed save and protects Cancel", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(updateProduct).mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 400,
      data: { fieldErrors: { name: ["Check the name."] } },
    },
  });
  setup();
  const { user, modal } = await edit();
  await user.type(modal.getByLabelText("Product name"), " changed");
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  expect(await modal.findByText("Check the name.")).toBeInTheDocument();
  expect(modal.getByLabelText("Product name")).toHaveValue("Latte changed");
  expect(modal.getByLabelText("Product name")).toHaveFocus();
  await user.click(modal.getByRole("button", { name: "Cancel" }));
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Discard product changes?" }),
    ).getByRole("button", { name: "Keep editing" }),
  );
  expect(modal.getByLabelText("Product name")).toHaveValue("Latte changed");
});
it("can change another field when categories cannot be loaded, retaining its category", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, categoryId: category.id }],
  });
  vi.mocked(listCategories).mockRejectedValue(new Error("offline"));
  vi.mocked(updateProduct).mockResolvedValue({ product });
  setup();
  const { user, modal } = await edit();
  expect(
    await modal.findByText(/Keep the current category/),
  ).toBeInTheDocument();
  await user.type(modal.getByLabelText("Product name"), " changed");
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateProduct).toHaveBeenCalledWith("a", "p", {
      name: "Latte changed",
    }),
  );
});
it("blocks repeat saves and ignores an edit completed after unmount", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(updateProduct).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const { user, modal } = await edit();
  await user.type(modal.getByLabelText("Product name"), " changed");
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  expect(modal.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(modal.getByRole("button", { name: "Cancel" })).toBeDisabled();
  unmount();
  resolve({ product: { ...product, name: "Late" } });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [product],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
  expect(updateProduct).toHaveBeenCalledTimes(1);
});
it.each(["OWNER", "ADMIN", "MANAGER"] as const)(
  "lets %s create and see a saved product with success feedback",
  async (role) => {
    const { client } = setup(role);
    const { user, modal } = await basics();
    vi.mocked(listProducts).mockResolvedValue({ products: [product] });
    await user.click(modal.getByRole("button", { name: "Create product" }));
    await waitFor(() =>
      expect(createProduct).toHaveBeenCalledWith("a", {
        name: "Latte",
        price: "12.50",
        description: "",
        imageUrl: "",
        status: "AVAILABLE",
        isFeatured: false,
        sortOrder: 0,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByText("/latte")).toBeInTheDocument();
    expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
      products: [product],
    });
    expect(useFeedbackStore.getState().notices[0].kind).toBe("toast");
  },
);
it.each(["CASHIER", "KITCHEN"] as const)(
  "does not expose product management to %s",
  async (role) => {
    setup(role);
    expect(
      screen.queryByRole("button", { name: "Create product" }),
    ).not.toBeInTheDocument();
    expect(listProducts).not.toHaveBeenCalled();
  },
);
it("validates required fields and filters nonnumeric price input", async () => {
  setup();
  const { user, modal } = await open();
  await user.click(modal.getByRole("button", { name: "Create product" }));
  expect(await modal.findByText(/Enter a product name/)).toBeInTheDocument();
  expect(modal.getByLabelText("Product name")).toHaveFocus();
  await user.type(modal.getByLabelText("Price"), "abc-1e2");
  expect(modal.getByLabelText("Price")).toHaveValue("12");
  expect(createProduct).not.toHaveBeenCalled();
});
it("creates optional fields and warns when the selected category is hidden", async () => {
  setup();
  const { user, modal } = await basics();
  await user.click(modal.getByLabelText("Category"));
  await user.click(modal.getByRole("option", { name: /Coffee/ }));
  await user.click(modal.getByLabelText("Menu status"));
  await user.click(modal.getByRole("option", { name: "Sold out" }));
  await user.type(modal.getByLabelText(/Description/), "Milky");
  await user.click(modal.getByText("Image & display options"));
  expect(modal.getByLabelText(/Saved photo/)).toHaveAttribute("readonly");
  await user.click(modal.getByRole("checkbox"));
  await user.clear(modal.getByLabelText("Display order"));
  await user.type(modal.getByLabelText("Display order"), "7");
  expect(modal.getByText(/category is hidden/i)).toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await waitFor(() =>
    expect(createProduct).toHaveBeenCalledWith("a", {
      name: "Latte",
      price: "12.50",
      categoryId: "cat-a",
      description: "Milky",
      status: "SOLD_OUT",
      imageUrl: "",
      isFeatured: true,
      sortOrder: 7,
    }),
  );
});
it("reveals a collapsed advanced field when validation fails", async () => {
  setup();
  const { user, modal } = await basics();
  await user.click(modal.getByText("Image & display options"));
  await user.clear(modal.getByLabelText("Display order"));
  await user.type(modal.getByLabelText("Display order"), "invalid");
  await user.click(modal.getByText("Image & display options"));
  await user.click(modal.getByRole("button", { name: "Create product" }));
  expect(modal.getByLabelText("Display order")).toHaveFocus();
  expect(
    modal.getByLabelText("Display order").closest("details"),
  ).toHaveAttribute("open");
  expect(createProduct).not.toHaveBeenCalled();
});
it("keeps the draft and focuses duplicate-name feedback", async () => {
  vi.mocked(createProduct).mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 409,
      data: { fieldErrors: { name: ["Choose another name."] } },
    },
  });
  setup();
  const { user, modal } = await basics();
  await user.click(modal.getByRole("button", { name: "Create product" }));
  expect(await modal.findByText("Choose another name.")).toBeInTheDocument();
  expect(modal.getByLabelText("Product name")).toHaveValue("Latte");
  expect(modal.getByLabelText("Product name")).toHaveFocus();
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
it("does not automatically retry an uncertain creation", async () => {
  vi.mocked(createProduct).mockRejectedValue({ isAxiosError: true });
  setup();
  const { user, modal } = await basics();
  await user.click(modal.getByRole("button", { name: "Create product" }));
  expect(await modal.findByText(/confirm creation/)).toBeInTheDocument();
  expect(createProduct).toHaveBeenCalledTimes(1);
  expect(modal.getByRole("button", { name: "Create product" })).toBeDisabled();
  await user.click(modal.getByRole("button", { name: "Create product" }));
  expect(createProduct).toHaveBeenCalledTimes(1);
  expect(modal.getByLabelText("Price")).toHaveValue("12.50");
});
it("protects a draft when Cancel or Escape is used", async () => {
  setup();
  const { user, modal } = await basics();
  await user.click(modal.getByRole("button", { name: "Cancel" }));
  const decision = within(
    screen.getByRole("dialog", { name: "Discard this product?" }),
  );
  await user.click(decision.getByRole("button", { name: "Keep creating" }));
  expect(modal.getByLabelText("Product name")).toHaveValue("Latte");
  fireEvent(
    screen.getByRole("dialog", { name: "Create product" }),
    new Event("cancel", { cancelable: true }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Discard this product?" }),
    ).getByRole("button", { name: "Discard changes" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(createProduct).not.toHaveBeenCalled();
});
it("ignores a late creation after the shop view is unmounted", async () => {
  let resolve!: (value: { product: MenuProduct }) => void;
  vi.mocked(createProduct).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { client, unmount } = setup();
  const { user, modal } = await basics();
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
  unmount();
  resolve({ product });
  await new Promise((done) => setTimeout(done, 20));
  expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
    products: [],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("creates once then uploads the selected photo to the saved product", async () => {
  vi.mocked(uploadProductImage).mockResolvedValue({
    product: { ...product, imageUrl: "https://example.com/photo.webp" },
    storagePath: "a/p/photo.webp",
  });
  setup();
  const { user, modal } = await basics();
  const file = new File(["photo"], "latte.png", { type: "image/png" });
  await user.upload(modal.getByLabelText(/Photo.*optional/), file);
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await waitFor(() =>
    expect(uploadProductImage).toHaveBeenCalledWith(
      "a",
      "p",
      file,
      expect.any(Function),
    ),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Create product" }),
    ).not.toBeInTheDocument(),
  );
  expect(createProduct).toHaveBeenCalledTimes(1);
});
it("keeps the saved product on photo failure and retries only its upload", async () => {
  vi.mocked(uploadProductImage).mockRejectedValueOnce({
    isAxiosError: true,
    response: { status: 503, data: { code: "PRODUCT_STORAGE_UNAVAILABLE" } },
  });
  setup();
  const { user, modal } = await basics();
  const file = new File(["photo"], "latte.png", { type: "image/png" });
  await user.upload(modal.getByLabelText(/Photo.*optional/), file);
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await modal.findByText(/Product created. Photo uploads are unavailable/);
  expect(modal.getByLabelText("Product name")).toBeDisabled();
  vi.mocked(uploadProductImage).mockResolvedValueOnce({
    product,
    storagePath: "a/p/photo.webp",
  });
  await user.click(modal.getByRole("button", { name: "Retry upload" }));
  await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(2));
  expect(createProduct).toHaveBeenCalledTimes(1);
});
it("rejects invalid creation photos before saving and permits removing them", async () => {
  setup();
  const { user, modal } = await basics();
  fireEvent.change(modal.getByLabelText(/Photo.*optional/), {
    target: { files: [new File(["svg"], "x.svg", { type: "image/svg+xml" })] },
  });
  expect(
    modal.getByText("Choose a JPEG, PNG or WebP image."),
  ).toBeInTheDocument();
  expect(modal.getByRole("button", { name: "Create product" })).toBeDisabled();
  expect(createProduct).not.toHaveBeenCalled();
  await user.click(modal.getByRole("button", { name: "Clear selection" }));
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1));
  expect(uploadProductImage).not.toHaveBeenCalled();
});

it("can finish after an upload failure without recreating or uploading again", async () => {
  vi.mocked(uploadProductImage).mockRejectedValueOnce(new Error("offline"));
  setup();
  const { user, modal } = await basics();
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["photo"], "latte.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await modal.findByRole("button", { name: "Retry upload" });
  await user.click(modal.getByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Create product" }),
    ).not.toBeInTheDocument(),
  );
  expect(createProduct).toHaveBeenCalledTimes(1);
  expect(uploadProductImage).toHaveBeenCalledTimes(1);
});
it("blocks duplicate creation during upload and ignores completion after leaving", async () => {
  let finish!: (value: Awaited<ReturnType<typeof uploadProductImage>>) => void;
  vi.mocked(uploadProductImage).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { unmount, client } = setup();
  const { user, modal } = await basics();
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["photo"], "latte.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await waitFor(() => expect(uploadProductImage).toHaveBeenCalledTimes(1));
  expect(
    modal.getByRole("button", { name: "Uploading photo..." }),
  ).toBeDisabled();
  expect(modal.getByRole("button", { name: "Done" })).toBeDisabled();
  unmount();
  finish({
    product: { ...product, imageUrl: "https://example.com/late.webp" },
    storagePath: "a/p/late.webp",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(createProduct).toHaveBeenCalledTimes(1);
  expect(
    client.getQueryData<{ products: MenuProduct[] }>(productsKey("user-a", "a"))
      ?.products[0]?.imageUrl,
  ).not.toBe("https://example.com/late.webp");
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("uses the same accessible photo panel in Create and Edit and clears only the selected replacement", async () => {
  const old = { ...product, imageUrl: "https://example.com/current.webp" };
  vi.mocked(listProducts).mockResolvedValue({ products: [old] });
  setup();
  const { user, modal } = await edit();
  expect(
    modal.getByRole("button", { name: "Replace photo" }),
  ).toBeInTheDocument();
  expect(modal.getByAltText("Current product photo")).toHaveAttribute(
    "src",
    old.imageUrl,
  );
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["png"], "new.png", { type: "image/png" }),
  );
  expect(modal.getByText("Ready to upload")).toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Remove photo" }));
  expect(modal.getByAltText("Current product photo")).toHaveAttribute(
    "src",
    old.imageUrl,
  );
  expect(uploadProductImage).not.toHaveBeenCalled();
  expect(
    modal.queryByRole("button", { name: "Upload image" }),
  ).not.toBeInTheDocument();
  await user.click(modal.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit product" }),
    ).not.toBeInTheDocument(),
  );
  const create = await open();
  expect(
    create.modal.getByRole("button", { name: "Choose photo" }),
  ).toBeInTheDocument();
  expect(create.modal.getByLabelText(/Photo.*optional/)).toHaveAttribute(
    "accept",
    "image/jpeg,image/png,image/webp",
  );
});
it("supports photo drops, rejects multiple files and releases previews", async () => {
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:photo");
      static revokeObjectURL = revoke;
    },
  );
  setup();
  const { user, modal } = await basics();
  const file = new File(["png"], "new.png", { type: "image/png" });
  fireEvent.drop(modal.getByRole("button", { name: "Choose photo" }), {
    dataTransfer: { files: [file] },
  });
  expect(modal.getByAltText("Selected product photo preview")).toHaveAttribute(
    "src",
    "blob:photo",
  );
  fireEvent.drop(modal.getByRole("button", { name: "Replace photo" }), {
    dataTransfer: { files: [file, file] },
  });
  expect(modal.getByText("Choose one photo at a time.")).toBeInTheDocument();
  expect(modal.getByRole("button", { name: "Create product" })).toBeDisabled();
  await user.click(modal.getByRole("button", { name: "Clear selection" }));
  expect(revoke).toHaveBeenCalledWith("blob:photo");
  expect(
    modal.queryByAltText("Selected product photo preview"),
  ).not.toBeInTheDocument();
  expect(modal.getByRole("button", { name: "Create product" })).toBeEnabled();
});

it.each([
  { isAxiosError: true },
  {
    isAxiosError: true,
    response: { status: 503, data: { code: "PRODUCT_IMAGE_SAVE_UNCERTAIN" } },
  },
  { isAxiosError: true, response: { status: 403, data: {} } },
])(
  "blocks photo retries after uncertain saves or access loss",
  async (failure) => {
    vi.mocked(listProducts).mockResolvedValue({ products: [product] });
    vi.mocked(uploadProductImage).mockRejectedValue(failure);
    setup();
    const { user, modal } = await edit();
    await user.upload(
      modal.getByLabelText(/Photo.*optional/),
      new File(["png"], "new.png", { type: "image/png" }),
    );
    await user.click(modal.getByRole("button", { name: "Upload image" }));
    await waitFor(() =>
      expect(
        modal.getByRole("button", { name: "Upload image" }),
      ).toBeDisabled(),
    );
    expect(modal.getByRole("button", { name: "Replace photo" })).toBeDisabled();
    await user.click(modal.getByRole("button", { name: "Upload image" }));
    expect(uploadProductImage).toHaveBeenCalledTimes(1);
    expect(modal.getByRole("button", { name: "Cancel" })).toBeEnabled();
  },
);

it("separates archived products and resets filters when switching views", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [
      product,
      {
        ...product,
        id: "old",
        name: "Old drink",
        slug: "old-drink",
        isArchived: true,
      },
    ],
  });
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Latte" });
  expect(
    screen.queryByRole("heading", { name: "Old drink" }),
  ).not.toBeInTheDocument();
  await user.type(screen.getByLabelText("Find a product"), "Latte");
  await user.click(screen.getByRole("button", { name: /Archived products/ }));
  expect(screen.getByLabelText("Find a product")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: /Archived products/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByRole("heading", { name: "Old drink" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Latte" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Restore Old drink" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Reorder.*products/ }),
  ).not.toBeInTheDocument();
  expect(setProductArchived).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Active products/ }));
  expect(screen.getByRole("heading", { name: "Latte" })).toBeInTheDocument();
});

it("keeps numbered navigation valid as a large menu approaches its last page", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: Array.from({ length: 49 }, (_, index) => ({
      ...product,
      id: `large-${index}`,
      name: `Item ${index}`,
      slug: `item-${index}`,
      sortOrder: index,
    })),
  });
  setup();
  const user = userEvent.setup();
  await screen.findByRole("heading", { name: "Item 0" });
  expect(
    screen.getByRole("button", { name: "Previous product page" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Go to product page 5" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Go to product page 7" }),
  );
  expect(screen.getByRole("heading", { name: "Item 48" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Next product page" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Go to product page 7" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.queryByRole("button", { name: "Go to product page 8" }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Previous product page" }),
  );
  expect(screen.getByRole("heading", { name: "Item 40" })).toBeInTheDocument();
});

it("clears a saved photo through Save changes without accepting a replacement URL", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, imageUrl: "https://example.com/saved.webp" }],
  });
  vi.mocked(updateProduct).mockResolvedValue({
    product: { ...product, imageUrl: null },
  });
  setup();
  const { user, modal } = await edit();
  await user.click(modal.getByText("Image & display options"));
  expect(modal.getByLabelText("Saved photo")).toHaveAttribute("readonly");
  await user.click(modal.getByRole("button", { name: "Remove saved photo" }));
  await user.click(modal.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateProduct).toHaveBeenCalledWith("a", "p", { imageUrl: "" }),
  );
});

it("locks photo retries after an uncertain network outcome during creation", async () => {
  vi.mocked(uploadProductImage).mockRejectedValue(
    new Error("Disconnected after sending"),
  );
  setup();
  const { user, modal } = await basics();
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["png"], "photo.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Create product" }));
  await modal.findByText(/Product created/);
  expect(modal.getByRole("button", { name: "Retry upload" })).toBeDisabled();
  expect(modal.getByRole("button", { name: "Done" })).toBeEnabled();
  expect(createProduct).toHaveBeenCalledTimes(1);
});
it("refreshes the customer menu and details after uploading an edited product photo", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(uploadProductImage).mockResolvedValue({
    product: { ...product, imageUrl: "https://example.com/new.webp" },
    storagePath: "a/p/new.webp",
  });
  const { client } = setup();
  client.setQueryData(["public-menu", "cafe-a"], { marker: "menu" });
  client.setQueryData(["public-product", "cafe-a", "p"], { marker: "details" });
  const { user, modal } = await edit();
  await user.upload(
    modal.getByLabelText(/Photo.*optional/),
    new File(["png"], "photo.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Upload image" }));
  await waitFor(() =>
    expect(client.getQueryState(["public-menu", "cafe-a"])?.isInvalidated).toBe(
      true,
    ),
  );
  expect(
    client.getQueryState(["public-product", "cafe-a", "p"])?.isInvalidated,
  ).toBe(true);
});

it.each([
  { ...product, id: "other-product" },
  { ...product, shopId: "other-shop" },
])(
  "does not cache an upload response for the wrong resource: %o",
  async (wrongProduct) => {
    vi.mocked(listProducts).mockResolvedValue({ products: [product] });
    vi.mocked(uploadProductImage).mockResolvedValue({
      product: wrongProduct,
      storagePath: "foreign",
    });
    const { client } = setup();
    const { user, modal } = await edit();
    await user.upload(
      modal.getByLabelText(/Photo.*optional/),
      new File(["png"], "photo.png", { type: "image/png" }),
    );
    await user.click(modal.getByRole("button", { name: "Upload image" }));
    await modal.findByText(/couldn't confirm the image save/);
    expect(client.getQueryData(productsKey("user-a", "a"))).toEqual({
      products: [product],
    });
    expect(modal.getByRole("button", { name: "Upload image" })).toBeDisabled();
  },
);
