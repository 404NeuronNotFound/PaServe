import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  cleanup,
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
it("makes a sold-out product available with inline category context and a toast", async () => {
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...product, status: "SOLD_OUT", categoryId: category.id }],
  });
  const saved = { ...product, categoryId: category.id };
  vi.mocked(setProductAvailable).mockResolvedValue({ product: saved });
  setup();
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", {
    name: "Make Latte available",
  });
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
  await user.click(
    await screen.findByRole("button", { name: "Make Latte available" }),
  );
  expect(
    await screen.findByText(/Product status changed elsewhere/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Make Latte available" }),
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
  await user.click(
    await screen.findByRole("button", { name: "Make Latte available" }),
  );
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
  await user.upload(modal.getByLabelText("Image file"), file);
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
  expect(modal.getByLabelText(/Image URL/)).toHaveValue(imageProduct.imageUrl);
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
  fireEvent.change(modal.getByLabelText("Image file"), {
    target: {
      files: [new File(["svg"], "bad.svg", { type: "image/svg+xml" })],
    },
  });
  expect(
    modal.getByText("Choose a JPEG, PNG or WebP image."),
  ).toBeInTheDocument();
  fireEvent.change(modal.getByLabelText("Image file"), {
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
    modal.getByLabelText("Image file"),
    new File(["png"], "a.png", { type: "image/png" }),
  );
  await user.click(modal.getByRole("button", { name: "Upload image" }));
  expect(
    await modal.findByText(/Your current image is kept/),
  ).toBeInTheDocument();
  expect(modal.getByLabelText(/Image URL/)).toHaveValue(
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
    modal.getByLabelText("Image file"),
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
  await user.click(
    await screen.findByRole("button", { name: "Archive Latte" }),
  );
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
  expect(screen.getByRole("button", { name: "Create product" })).toHaveFocus();
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
    await screen.findByRole("checkbox", { name: /Show archived products/ }),
  );
  expect(screen.getByText("Archived")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit Latte" }),
  ).not.toBeInTheDocument();
  vi.mocked(listProducts).mockResolvedValue({
    products: [{ ...hidden, isArchived: false }],
  });
  await user.click(screen.getByRole("button", { name: "Restore Latte" }));
  expect(await screen.findByText("Hidden")).toBeInTheDocument();
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
  await user.click(
    await screen.findByRole("button", { name: "Archive Latte" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep product",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(setProductArchived).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Archive Latte" })).toHaveFocus();
});
it("retains the confirmation with inline feedback for stale or uncertain requests", async () => {
  vi.mocked(listProducts).mockResolvedValue({ products: [product] });
  vi.mocked(setProductArchived).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Archive Latte" }),
  );
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
  await user.click(
    await screen.findByRole("button", { name: "Archive Latte" }),
  );
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
  await user.click(
    await screen.findByRole("button", { name: "Archive Latte" }),
  );
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
  await screen.findByRole("option", { name: /Coffee/ });
  await user.selectOptions(modal.getByLabelText("Category"), "");
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
  await user.selectOptions(modal.getByLabelText("Category"), "cat-a");
  await user.selectOptions(modal.getByLabelText("Menu status"), "SOLD_OUT");
  await user.type(modal.getByLabelText(/Description/), "Milky");
  await user.click(modal.getByText("Image & display options"));
  await user.type(
    modal.getByLabelText(/Image URL/),
    "https://example.com/a.jpg",
  );
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
      imageUrl: "https://example.com/a.jpg",
      isFeatured: true,
      sortOrder: 7,
    }),
  );
});
it("reveals a collapsed advanced field when validation fails", async () => {
  setup();
  const { user, modal } = await basics();
  await user.click(modal.getByText("Image & display options"));
  await user.type(
    modal.getByLabelText(/Image URL/),
    "http://example.com/a.jpg",
  );
  await user.click(modal.getByText("Image & display options"));
  await user.click(modal.getByRole("button", { name: "Create product" }));
  expect(modal.getByLabelText(/Image URL/)).toHaveFocus();
  expect(modal.getByLabelText(/Image URL/).closest("details")).toHaveAttribute(
    "open",
  );
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
