import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
} from "../../features/shops/api/categories";
import { useFeedbackStore } from "../../app/stores/feedback";
import { CategoriesPage } from "./CategoriesPage";
vi.mock("../../features/shops/api/categories", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/shops/api/categories")
  >()),
  createCategory: vi.fn(),
  listCategories: vi.fn(),
}));
const category = {
  id: "category-a",
  shopId: "a",
  name: "Coffee",
  slug: "coffee",
  sortOrder: 0,
  isVisible: true,
  createdAt: "2026-10-09T00:00:00Z",
};
beforeEach(() => {
  vi.mocked(listCategories).mockResolvedValue({ categories: [] });
  vi.mocked(createCategory).mockResolvedValue({ category });
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
