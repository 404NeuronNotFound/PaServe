import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { AxiosError } from "axios";
import type { UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import {
  createCategory,
  listCategories,
  categoriesKey,
  updateCategory,
  deleteCategory,
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
beforeEach(() => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [] });
  vi.mocked(createCategory).mockResolvedValue({ category });
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
      screen.getByText(/All linked products will be kept in Uncategorized/),
    ).toBeInTheDocument();
    expect(deleteCategory).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Keep category" }));
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
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
  expect(
    screen.queryByRole("region", { name: "Edit category" }),
  ).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("region", { name: "Edit category" }),
    ).not.toBeInTheDocument();
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
