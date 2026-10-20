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
import { AxiosError } from "axios";
import type { UserMembership, MenuCategory } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import {
  createCategory,
  listCategories,
  categoriesKey,
  updateCategory,
  deleteCategory,
  setCategoryVisibility,
  reorderCategories,
} from "../../features/shops/api/categories";
import { useFeedbackStore } from "../../app/stores/feedback";
import { CategoriesPage } from "./CategoriesPage";
vi.mock("../../features/shops/api/categories", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/shops/api/categories")
  >()),
  createCategory: vi.fn(),
  listCategories: vi.fn(),
  updateCategory: vi.fn(),
  deleteCategory: vi.fn(),
  setCategoryVisibility: vi.fn(),
  reorderCategories: vi.fn(),
}));
const category = {
  id: "category-a",
  shopId: "a",
  name: "Coffee",
  description: null,
  slug: "coffee",
  sortOrder: 0,
  isVisible: true,
  createdAt: "2026-10-09T00:00:00Z",
};
const meals = {
  ...category,
  id: "category-b",
  name: "Meals",
  slug: "meals",
  isVisible: false,
  sortOrder: 7,
};
it("moves focus to the category form from its first-category empty state", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [] });
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Name your first category" }));
  expect(screen.getByRole("textbox", { name: "Category name" })).toHaveFocus();
  expect(createCategory).not.toHaveBeenCalled();
});
it("previews visibility immediately, rolls back rejection and reconciles a retry", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  let reject!: (reason: unknown) => void;
  vi.mocked(setCategoryVisibility).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const { client } = setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Hide Coffee" }));
  expect(screen.getByText("Hidden")).toBeInTheDocument();
  expect(screen.getByText("Saving visibility…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show Coffee" })).toBeDisabled();
  expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({ categories: [category] });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
  await act(async () => reject({ isAxiosError: true, response: { status: 409 } }));
  expect(screen.getByText("Visible")).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("preview was reverted");
  expect(screen.getByRole("button", { name: "Hide Coffee" })).toBeEnabled();
  // Server values, including changes unrelated to the toggle, win on success.
  const saved = { ...category, isVisible: false, description: "Saved by server" };
  vi.mocked(setCategoryVisibility).mockResolvedValueOnce({ category: saved });
  vi.mocked(listCategories).mockResolvedValue({ categories: [saved] });
  await user.click(screen.getByRole("button", { name: "Hide Coffee" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Show Coffee" })).toBeEnabled());
  expect(screen.getByText("Saved by server")).toBeInTheDocument();
});

it("rollback keeps newer cached category data instead of restoring an old snapshot", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  let reject!: (reason: unknown) => void;
  vi.mocked(setCategoryVisibility).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const { client } = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Hide Coffee" }));
  act(() => client.setQueryData(categoriesKey("user-a", "a"), {
    categories: [{ ...category, name: "Updated coffee" }],
  }));
  vi.mocked(listCategories).mockResolvedValue({ categories: [{ ...category, name: "Updated coffee" }] });
  await act(async () => reject(new Error("Rejected")));
  expect(screen.getByText("Updated coffee")).toBeInTheDocument();
  expect(screen.getByText("Visible")).toBeInTheDocument();
});
it.each([undefined, 409])("reconciles saved visibility after an uncertain or conflicted write (%s)", async (status) => {
  const saved = { ...category, isVisible: false };
  vi.mocked(listCategories).mockResolvedValueOnce({ categories: [category] });
  let resolve!: (value: { categories: typeof category[] }) => void;
  vi.mocked(listCategories).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  vi.mocked(setCategoryVisibility).mockRejectedValueOnce({
    isAxiosError: true, ...(status ? { response: { status } } : {}),
  });
  const { client } = setup();
  client.setQueryData(["public-menu", "cafe-a"], { categories: [category] });
  await userEvent.click(await screen.findByRole("button", { name: "Hide Coffee" }));
  await screen.findByText(/Checking saved categories/);
  expect(screen.queryByText("Visible")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create category" })).toBeDisabled();
  await act(async () => resolve({ categories: [saved] }));
  expect(await screen.findByRole("button", { name: "Show Coffee" })).toBeEnabled();
  expect(screen.getByText("Hidden")).toBeInTheDocument();
  expect(setCategoryVisibility).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(["public-menu", "cafe-a"])?.isInvalidated).toBe(true);
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("keeps category changes locked across failed verification and unlocks only after a successful refresh", async () => {
  vi.mocked(listCategories).mockResolvedValueOnce({ categories: [category] }).mockRejectedValue(new Error("Offline"));
  vi.mocked(setCategoryVisibility).mockRejectedValueOnce({ isAxiosError: true });
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Hide Coffee" }));
  await screen.findByText(/Saved category visibility is unverified/);
  expect(screen.queryByText("Visible")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create category" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh categories" }));
  await screen.findByText(/Saved category visibility is unverified/);
  expect(screen.getByRole("button", { name: "Create category" })).toBeDisabled();
  vi.mocked(listCategories).mockResolvedValue({ categories: [{ ...category, isVisible: false }] });
  await user.click(screen.getByRole("button", { name: "Refresh categories" }));
  expect(await screen.findByRole("button", { name: "Show Coffee" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Create category" })).toBeEnabled();
  expect(setCategoryVisibility).toHaveBeenCalledTimes(1);
});

it("does not unlock category changes after a cancelled verification read", async () => {
  vi.mocked(listCategories).mockResolvedValueOnce({ categories: [category] });
  let resolve!: (value: { categories: typeof category[] }) => void;
  vi.mocked(listCategories).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  vi.mocked(setCategoryVisibility).mockRejectedValueOnce({ isAxiosError: true });
  const { client } = setup();
  await userEvent.click(await screen.findByRole("button", { name: "Hide Coffee" }));
  await screen.findByText(/Checking saved categories/);
  await act(async () => { await client.cancelQueries({ queryKey: categoriesKey("user-a", "a") }); });
  await screen.findByText(/Saved category visibility is unverified/);
  await act(async () => resolve({ categories: [category] }));
  expect(screen.getByRole("button", { name: "Create category" })).toBeDisabled();
  expect(screen.queryByText("Visible")).not.toBeInTheDocument();
  vi.mocked(listCategories).mockResolvedValue({ categories: [{ ...category, isVisible: false }] });
  await userEvent.click(screen.getByRole("button", { name: "Refresh categories" }));
  expect(await screen.findByRole("button", { name: "Show Coffee" })).toBeEnabled();
});
it("keeps ordering focused and updates the public menu cache only on Save and Undo", async () => {
  const visibleMeals = { ...meals, isVisible: true };
  const hidden = {
    ...category,
    id: "hidden",
    name: "Hidden",
    isVisible: false,
    sortOrder: 2,
  };
  const items = [category, visibleMeals, hidden];
  const menu = {
    shop: {
      name: "Cafe A",
      slug: "cafe-a",
      menuLayout: "compact",
      primaryColor: "#123456",
      accentColor: "#ABCDEF",
    },
    categories: [category, visibleMeals],
    products: [category, visibleMeals].map((item) => ({
      id: `product-${item.id}`,
      categoryId: item.id,
      name: `${item.name} item`,
      description: null,
      imageUrl: null,
      price: "10.00",
      status: "AVAILABLE",
    })),
    featuredProducts: [],
  };
  vi.mocked(listCategories).mockResolvedValue({ categories: items });
  const { client } = setup();
  client.setQueryData(["public-menu", "cafe-a"], menu);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Reorder categories" }),
  );
  expect(
    screen.queryByRole("region", { name: "Category order preview" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Move Meals up" }));
  expect(
    client
      .getQueryData<{ categories: typeof items }>(["public-menu", "cafe-a"])!
      .categories.map((item) => item.id),
  ).toEqual([category.id, meals.id]);
  expect(reorderCategories).not.toHaveBeenCalled();
  const saved = [visibleMeals, category, hidden].map((item, sortOrder) => ({
    ...item,
    sortOrder,
  }));
  vi.mocked(reorderCategories)
    .mockResolvedValueOnce({ categories: saved })
    .mockResolvedValueOnce({ categories: items });
  vi.mocked(listCategories).mockResolvedValue({ categories: saved });
  await user.click(screen.getByRole("button", { name: "Save order" }));
  await screen.findByRole("button", { name: "Reorder categories" });
  const cached = () =>
    client.getQueryData<{
      categories: typeof items;
      products: typeof menu.products;
    }>(["public-menu", "cafe-a"])!;
  expect(cached().categories.map((item) => [item.id, item.sortOrder])).toEqual([
    [meals.id, 0],
    [category.id, 1],
  ]);
  expect(cached().products).toEqual(menu.products);
  const notice = useFeedbackStore.getState().notices[0];
  if (notice.kind !== "snackbar") throw new Error("Missing Undo");
  await notice.action.onClick();
  expect(cached().categories.map((item) => item.id)).toEqual([
    category.id,
    meals.id,
  ]);
});
it.each(["OWNER", "ADMIN", "MANAGER"] as const)(
  "lets %s arrange, save and undo the full category order",
  async (role) => {
    vi.mocked(listCategories).mockResolvedValue({
      categories: [category, meals],
    });
    const saved = [
      { ...meals, sortOrder: 0 },
      { ...category, sortOrder: 1 },
    ];
    vi.mocked(reorderCategories)
      .mockResolvedValueOnce({ categories: saved })
      .mockResolvedValueOnce({
        categories: [
          { ...category, sortOrder: 0 },
          { ...meals, sortOrder: 1 },
        ],
      });
    const { client } = setup(role);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Reorder categories" }),
    );
    const editor = within(
      screen.getByRole("region", { name: "Reorder categories" }),
    );
    expect(
      editor.getByRole("button", { name: "Move Coffee up" }),
    ).toBeDisabled();
    expect(
      editor.getByRole("button", { name: "Move Meals down" }),
    ).toBeDisabled();
    expect(editor.getByRole("button", { name: "Save order" })).toBeDisabled();
    await user.click(editor.getByRole("button", { name: "Move Meals up" }));
    expect(editor.getByRole("status")).toHaveTextContent(
      "Meals moved to position 1 of 2.",
    );
    expect(reorderCategories).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Create category" }),
    ).toBeDisabled();
    vi.mocked(listCategories).mockResolvedValue({ categories: saved });
    await user.click(editor.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(reorderCategories).toHaveBeenCalledWith("a", {
        categoryIds: ["category-b", "category-a"],
        expectedOrder: ["category-a", "category-b"],
      }),
    );
    await screen.findByRole("button", { name: "Reorder categories" });
    expect(
      screen.queryByRole("region", { name: "Reorder categories" }),
    ).not.toBeInTheDocument();
    expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
      categories: saved,
    });
    const notice = useFeedbackStore.getState().notices[0];
    if (notice.kind !== "snackbar") throw new Error("Missing Undo");
    vi.mocked(listCategories).mockResolvedValue({
      categories: [
        { ...category, sortOrder: 0 },
        { ...meals, sortOrder: 1 },
      ],
    });
    await notice.action.onClick();
    expect(reorderCategories).toHaveBeenLastCalledWith("a", {
      categoryIds: ["category-a", "category-b"],
      expectedOrder: ["category-b", "category-a"],
    });
  },
);

it("keeps a reorder draft and explains a concurrent order conflict", async () => {
  vi.mocked(listCategories).mockResolvedValue({
    categories: [category, meals],
  });
  vi.mocked(reorderCategories).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409 },
  });
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Reorder categories" }),
  );
  const editor = within(
    screen.getByRole("region", { name: "Reorder categories" }),
  );
  await user.click(editor.getByRole("button", { name: "Move Meals up" }));
  await user.click(editor.getByRole("button", { name: "Save order" }));
  expect(
    await editor.findByText(/category list or order changed elsewhere/),
  ).toBeInTheDocument();
  expect(editor.getAllByRole("listitem")[0]).toHaveTextContent("Meals");
  expect(reorderCategories).toHaveBeenCalledTimes(1);
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("confirms discarding reorder changes and supports keeping the draft", async () => {
  const restore = mockDecisionDialog();
  try {
    vi.mocked(listCategories).mockResolvedValue({
      categories: [category, meals],
    });
    setup();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Reorder categories" }),
    );
    const editor = within(
      screen.getByRole("region", { name: "Reorder categories" }),
    );
    await user.click(editor.getByRole("button", { name: "Move Coffee down" }));
    await user.click(editor.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Keep arranging" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep arranging" }));
    expect(editor.getAllByRole("listitem")[0]).toHaveTextContent("Meals");
    await user.click(editor.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(
      screen.queryByRole("region", { name: "Reorder categories" }),
    ).not.toBeInTheDocument();
    expect(reorderCategories).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

it("blocks repeated saves and ignores a reorder completion after leaving the shop", async () => {
  vi.mocked(listCategories).mockResolvedValue({
    categories: [category, meals],
  });
  let resolve!: (result: { categories: (typeof category)[] }) => void;
  vi.mocked(reorderCategories).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount, client } = setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Reorder categories" }),
  );
  await user.click(screen.getByRole("button", { name: "Move Meals up" }));
  await user.dblClick(screen.getByRole("button", { name: "Save order" }));
  expect(reorderCategories).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  unmount();
  resolve({ categories: [meals, category] });
  await waitFor(() => expect(reorderCategories).toHaveBeenCalled());
  expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
    categories: [category, meals],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
let restoreDialogs: () => void;
beforeEach(() => {
  restoreDialogs = mockDecisionDialog();
  vi.mocked(listCategories).mockResolvedValue({ categories: [] });
  vi.mocked(createCategory).mockResolvedValue({ category });
});

it("hides and restores a category with one Undo action, retaining a creation draft", async () => {
  const hidden = { ...category, isVisible: false };
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  vi.mocked(setCategoryVisibility)
    .mockResolvedValueOnce({ category: hidden })
    .mockResolvedValueOnce({ category });
  const { client } = setup();
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Hide Coffee" });
  await user.type(
    screen.getByRole("textbox", { name: "Category name" }),
    "Meals draft",
  );
  vi.mocked(listCategories).mockResolvedValue({ categories: [hidden] });
  await user.click(screen.getByRole("button", { name: "Hide Coffee" }));
  await screen.findByRole("button", { name: "Show Coffee" });
  expect(setCategoryVisibility).toHaveBeenCalledExactlyOnceWith(
    "a",
    "category-a",
    { isVisible: false, expectedVisibility: true },
  );
  expect(screen.getByText("Hidden")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Meals draft");
  const notice = useFeedbackStore.getState().notices[0];
  expect(notice.kind).toBe("snackbar");
  if (notice.kind !== "snackbar") throw new Error("Missing Undo");
  expect(notice.action.label).toBe("Undo");
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  await notice.action.onClick();
  await screen.findByRole("button", { name: "Hide Coffee" });
  expect(setCategoryVisibility).toHaveBeenLastCalledWith("a", "category-a", {
    isVisible: true,
    expectedVisibility: false,
  });
  expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
    categories: [category],
  });
});

it("shows a hidden category directly without a confirmation dialog", async () => {
  const hidden = { ...category, isVisible: false };
  vi.mocked(listCategories).mockResolvedValue({ categories: [hidden] });
  vi.mocked(setCategoryVisibility).mockResolvedValue({ category });
  setup();
  const button = await screen.findByRole("button", { name: "Show Coffee" });
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  await userEvent.setup().click(button);
  await screen.findByRole("button", { name: "Hide Coffee" });
  expect(setCategoryVisibility).toHaveBeenCalledWith("a", "category-a", {
    isVisible: true,
    expectedVisibility: false,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each([
  [{ isAxiosError: true }, /couldn’t confirm visibility/],
  [
    { isAxiosError: true, response: { status: 409 } },
    /Visibility changed elsewhere/,
  ],
  [{ isAxiosError: true, response: { status: 403 } }, /your access changed/],
] as const)(
  "retains the category and shows contextual visibility failure %j",
  async (failure, message) => {
    vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
    vi.mocked(setCategoryVisibility).mockRejectedValue(failure);
    setup();
    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Hide Coffee" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(setCategoryVisibility).toHaveBeenCalledTimes(1);
    expect(useFeedbackStore.getState().notices).toHaveLength(0);
  },
);

it("blocks duplicate visibility submissions and ignores completion after leaving", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  let resolve!: (value: { category: typeof category }) => void;
  vi.mocked(setCategoryVisibility).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount, client } = setup();
  const user = userEvent.setup();
  const button = await screen.findByRole("button", { name: "Hide Coffee" });
  await user.dblClick(button);
  expect(setCategoryVisibility).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Edit Coffee" })).toBeDisabled();
  unmount();
  resolve({ category: { ...category, isVisible: false } });
  await waitFor(() => expect(setCategoryVisibility).toHaveBeenCalled());
  expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
    categories: [category],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("does not run a stale Undo after switching shops", async () => {
  const hidden = { ...category, isVisible: false };
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  vi.mocked(setCategoryVisibility).mockResolvedValue({ category: hidden });
  const { unmount } = setup();
  const button = await screen.findByRole("button", { name: "Hide Coffee" });
  vi.mocked(listCategories).mockResolvedValue({ categories: [hidden] });
  await userEvent.setup().click(button);
  await screen.findByRole("button", { name: "Show Coffee" });
  const notice = useFeedbackStore.getState().notices[0];
  if (notice.kind !== "snackbar") throw new Error("Missing Undo");
  unmount();
  await expect(notice.action.onClick()).rejects.toThrow(/Return to this shop/);
  expect(setCategoryVisibility).toHaveBeenCalledTimes(1);
});

it("reports an Undo conflict without overwriting the newer category state", async () => {
  const hidden = { ...category, isVisible: false };
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  vi.mocked(setCategoryVisibility)
    .mockResolvedValueOnce({ category: hidden })
    .mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
  const { client } = setup();
  const button = await screen.findByRole("button", { name: "Hide Coffee" });
  vi.mocked(listCategories).mockResolvedValue({ categories: [hidden] });
  await userEvent.setup().click(button);
  await screen.findByRole("button", { name: "Show Coffee" });
  const notice = useFeedbackStore.getState().notices[0];
  if (notice.kind !== "snackbar") throw new Error("Missing Undo");
  await expect(notice.action.onClick()).rejects.toThrow(
    /Visibility changed elsewhere/,
  );
  expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
    categories: [hidden],
  });
});

function mockDecisionDialog() {
  const show = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const close = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );
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
  return () => {
    if (show)
      Object.defineProperty(HTMLDialogElement.prototype, "showModal", show);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (close)
      Object.defineProperty(HTMLDialogElement.prototype, "close", close);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  };
}

it("confirms category deletion, preserves products in its explanation, and refreshes the list", async () => {
  const restore = mockDecisionDialog();
  try {
    vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
    vi.mocked(deleteCategory).mockResolvedValue(undefined);
    setup();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Delete Coffee" }),
    );
    expect(screen.getByRole("button", { name: "Keep category" })).toHaveFocus();
    expect(
      screen.getByText(/Your products move to Uncategorized/),
    ).toBeInTheDocument();
    expect(deleteCategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep category" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(deleteCategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Delete Coffee" }));
    vi.mocked(listCategories).mockResolvedValue({ categories: [] });
    await user.click(screen.getByRole("button", { name: "Delete category" }));
    await waitFor(() =>
      expect(deleteCategory).toHaveBeenCalledExactlyOnceWith("a", "category-a"),
    );
    expect(
      await screen.findByText("A place for every favorite."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      useFeedbackStore
        .getState()
        .notices.some((notice) =>
          notice.message.includes("Linked products were kept"),
        ),
    ).toBe(true);
  } finally {
    restore();
  }
});

it("keeps the category and explains an unconfirmed deletion without automatic retry", async () => {
  const restore = mockDecisionDialog();
  try {
    vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
    vi.mocked(deleteCategory).mockRejectedValue({ isAxiosError: true });
    setup();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Delete Coffee" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete category" }));
    expect(
      await screen.findByText(/We couldn’t confirm deletion/),
    ).toBeInTheDocument();
    expect(deleteCategory).toHaveBeenCalledTimes(1);
    expect(screen.getByText("/coffee")).toBeInTheDocument();
    expect(useFeedbackStore.getState().notices).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Keep category" }));
  } finally {
    restore();
  }
});

it("ignores a deletion completion after leaving the shop page", async () => {
  const restore = mockDecisionDialog();
  try {
    vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
    let resolve!: () => void;
    vi.mocked(deleteCategory).mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const { client, unmount } = setup();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Delete Coffee" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete category" }));
    unmount();
    resolve();
    await waitFor(() => expect(deleteCategory).toHaveBeenCalled());
    expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
      categories: [category],
    });
    expect(useFeedbackStore.getState().notices).toHaveLength(0);
  } finally {
    restore();
  }
});
afterEach(() => {
  cleanup();
  restoreDialogs();
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
          <CategoriesPage />
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
it.each(["OWNER", "ADMIN", "MANAGER"] as const)(
  "lets %s create in the active shop and shows the saved category",
  async (role) => {
    setup(role);
    await screen.findByText("A place for every favorite.");
    const user = userEvent.setup();
    await user.type(
      screen.getByRole("textbox", { name: "Category name" }),
      " Coffee ",
    );
    vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
    await user.click(screen.getByRole("button", { name: "Create category" }));
    await waitFor(() =>
      expect(createCategory).toHaveBeenCalledWith("a", { name: "Coffee" }),
    );
    expect(await screen.findByText("/coffee")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(
      useFeedbackStore
        .getState()
        .notices.some((message) => message.message.includes("Coffee")),
    ).toBe(true);
  },
);
it.each(["CASHIER", "KITCHEN"] as const)(
  "blocks %s without fetching tenant data",
  (role) => {
    setup(role);
    expect(screen.getByText(/don’t have permission/)).toBeInTheDocument();
    expect(listCategories).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  },
);
it("validates a blank name and focuses the field", async () => {
  setup();
  await screen.findByText("A place for every favorite.");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Create category" }));
  expect(screen.getByText("Enter a category name.")).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveFocus();
  expect(createCategory).not.toHaveBeenCalled();
});
it("preserves the draft and shows a duplicate field error", async () => {
  vi.mocked(createCategory).mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 409,
      data: { fieldErrors: { name: ["Choose a different category name."] } },
    },
  } as AxiosError);
  setup();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), "Coffee");
  await user.click(screen.getByRole("button", { name: "Create category" }));
  expect(
    await screen.findByText("Choose a different category name."),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Coffee");
});
it("recovers from a failed list request without losing the draft", async () => {
  vi.mocked(listCategories)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ categories: [] });
  setup();
  await screen.findByText(/couldn’t load your categories/);
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), "Meals");
  await user.click(screen.getByRole("button", { name: "Refresh categories" }));
  expect(
    await screen.findByText("A place for every favorite."),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox")).toHaveValue("Meals");
});
it("ignores a creation response after the page is unmounted", async () => {
  let resolve!: (value: { category: typeof category }) => void;
  vi.mocked(createCategory).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { unmount, client } = setup();
  const user = userEvent.setup();
  await user.type(screen.getByRole("textbox"), "Coffee");
  await user.click(screen.getByRole("button", { name: "Create category" }));
  unmount();
  resolve({ category });
  await waitFor(() => expect(createCategory).toHaveBeenCalled());
  expect(client.getQueryData(categoriesKey("user-a", "a"))).toEqual({
    categories: [],
  });
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("edits display details and retains the menu address", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  const edited = {
    ...category,
    name: "Hot Drinks",
    description: "Fresh coffee",
  };
  vi.mocked(updateCategory).mockResolvedValue({ category: edited });
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Coffee" }));
  const editor = within(screen.getByRole("region", { name: "Edit category" }));
  const name = editor.getByRole("textbox", { name: "Category name" });
  expect(name).toHaveFocus();
  await user.clear(name);
  await user.type(name, "Hot Drinks");
  await user.type(
    editor.getByRole("textbox", { name: /Description/ }),
    "Fresh coffee",
  );
  expect(editor.getByText("/coffee")).toBeInTheDocument();
  vi.mocked(listCategories).mockResolvedValue({ categories: [edited] });
  await user.click(editor.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateCategory).toHaveBeenCalledWith("a", "category-a", {
      name: "Hot Drinks",
      description: "Fresh coffee",
    }),
  );
  expect(
    await screen.findByRole("button", { name: "Edit Hot Drinks" }),
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit category" }),
    ).not.toBeInTheDocument(),
  );
});

it("keeps invalid edit values and blocks empty names", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Coffee" }));
  const editor = within(screen.getByRole("region", { name: "Edit category" }));
  await user.clear(editor.getByRole("textbox", { name: "Category name" }));
  await user.click(editor.getByRole("button", { name: "Save changes" }));
  expect(editor.getByText("Enter a category name.")).toBeInTheDocument();
  expect(updateCategory).not.toHaveBeenCalled();
});

it("preserves the edit draft when saving fails", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  vi.mocked(updateCategory).mockRejectedValue(new Error("offline"));
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Coffee" }));
  const editor = within(screen.getByRole("region", { name: "Edit category" }));
  await user.type(
    editor.getByRole("textbox", { name: /Description/ }),
    "Fresh coffee",
  );
  await user.click(editor.getByRole("button", { name: "Save changes" }));
  expect(
    await editor.findByText("We couldn’t save the category. Please try again."),
  ).toBeInTheDocument();
  expect(editor.getByRole("textbox", { name: /Description/ })).toHaveValue(
    "Fresh coffee",
  );
});

it("confirms discarding edits and supports keeping the draft", async () => {
  const originalShow = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  );
  const originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );
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
  try {
    vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
    setup();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Edit Coffee" }),
    );
    const editor = within(
      screen.getByRole("region", { name: "Edit category" }),
    );
    await user.type(
      editor.getByRole("textbox", { name: /Description/ }),
      "Draft",
    );
    await user.click(editor.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(editor.getByRole("textbox", { name: /Description/ })).toHaveValue(
      "Draft",
    );
    await user.click(editor.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit category" }),
      ).not.toBeInTheDocument(),
    );
    expect(updateCategory).not.toHaveBeenCalled();
  } finally {
    if (originalShow)
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "showModal",
        originalShow,
      );
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
    if (originalClose)
      Object.defineProperty(
        HTMLDialogElement.prototype,
        "close",
        originalClose,
      );
    else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});

it("opens an edit modal, handles Escape, and restores focus to its category", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  setup();
  const user = userEvent.setup();
  const trigger = await screen.findByRole("button", { name: "Edit Coffee" });
  await user.click(trigger);
  const modal = screen.getByRole("dialog", { name: "Edit category" });
  expect(modal).toHaveAttribute("aria-modal", "true");
  expect(
    within(modal).getByRole("textbox", { name: "Category name" }),
  ).toHaveFocus();
  fireEvent(modal, new Event("cancel", { cancelable: true }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit category" }),
    ).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(updateCategory).not.toHaveBeenCalled();
});

it("protects dirty edits on Escape and Close while retaining the draft and count", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Coffee" }));
  const modal = screen.getByRole("dialog", { name: "Edit category" });
  const description = within(modal).getByRole("textbox", {
    name: /Description/,
  });
  await user.type(description, "Fresh coffee");
  expect(within(modal).getByText("12/500")).toBeInTheDocument();
  fireEvent(modal, new Event("cancel", { cancelable: true }));
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(description).toHaveValue("Fresh coffee");
  await user.click(
    screen.getByRole("button", { name: "Close category editor" }),
  );
  expect(
    screen.getByRole("dialog", { name: "Discard category changes?" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit category" }),
    ).not.toBeInTheDocument(),
  );
  expect(updateCategory).not.toHaveBeenCalled();
});

it("blocks modal dismissal and duplicate saves while an edit is pending", async () => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [category] });
  let resolve!: (result: { category: MenuCategory }) => void;
  vi.mocked(updateCategory).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  setup();
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit Coffee" }));
  const modal = screen.getByRole("dialog", { name: "Edit category" });
  await user.type(
    within(modal).getByRole("textbox", { name: /Description/ }),
    "Draft",
  );
  await user.dblClick(
    within(modal).getByRole("button", { name: "Save changes" }),
  );
  expect(updateCategory).toHaveBeenCalledTimes(1);
  expect(
    within(modal).getByRole("button", { name: "Close category editor" }),
  ).toBeDisabled();
  expect(within(modal).getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent(modal, new Event("cancel", { cancelable: true }));
  expect(modal).toBeInTheDocument();
  resolve({ category: { ...category, description: "Draft" } });
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Edit category" }),
    ).not.toBeInTheDocument(),
  );
});

it.each([
  { isAxiosError: true },
  { isAxiosError: true, response: { status: 503, data: {} } },
])(
  "requires a successful refresh after uncertain category creation",
  async (failure) => {
    vi.mocked(createCategory).mockRejectedValue(failure);
    setup();
    const user = userEvent.setup();
    await screen.findByText("A place for every favorite.");
    await user.type(screen.getByRole("textbox"), "Coffee");
    await user.click(screen.getByRole("button", { name: "Create category" }));
    await screen.findByText(/confirm creation/);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Create category" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Create category" }));
    expect(createCategory).toHaveBeenCalledTimes(1);
    vi.mocked(listCategories).mockRejectedValueOnce(new Error("offline"));
    await user.click(
      screen.getByRole("button", { name: "Refresh categories" }),
    );
    await screen.findByText(/load your categories/);
    expect(
      screen.getByRole("button", { name: "Create category" }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Refresh categories" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create category" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("textbox")).toHaveValue("Coffee");
  },
);
