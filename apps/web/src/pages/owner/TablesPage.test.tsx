import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CurrentUserResponse,
  UserMembership,
  CreateTableResponse,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  createTable,
  listTables,
  tablesKey,
} from "../../features/shops/api/tables";
import { TablesPage } from "./TablesPage";

vi.mock("../../features/shops/api/tables", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/shops/api/tables")>()),
  createTable: vi.fn(),
  listTables: vi.fn(),
}));
const table = {
  id: "table-a",
  shopId: "a",
  number: 12,
  code: "T12",
  isActive: true,
  createdAt: "2026-10-11T00:00:00Z",
};
const membership = (
  role: UserMembership["role"] = "OWNER",
  shopId = "a",
): UserMembership => ({
  id: `member-${shopId}`,
  shopId,
  role,
  shop: {
    id: shopId,
    name: `Cafe ${shopId}`,
    slug: `cafe-${shopId}`,
    isActive: true,
  },
});
function setup(role: UserMembership["role"] = "OWNER") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(currentUserKey, {
    user: { id: "user-a" },
  } as CurrentUserResponse);
  const page = (shopId = "a") => (
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider value={membership(role, shopId)}>
        <TablesPage />
      </ActiveShopContext.Provider>
    </QueryClientProvider>
  );
  return { ...render(page()), client, page };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTables).mockResolvedValue({ tables: [] });
  vi.mocked(createTable).mockImplementation(async () => {
    vi.mocked(listTables).mockResolvedValue({ tables: [table] });
    return { table };
  });
});
afterEach(cleanup);

it.each(["OWNER", "ADMIN"] as const)(
  "lets %s create under the active shop and shows the saved table",
  async (role) => {
    setup(role);
    const user = userEvent.setup();
    await screen.findByText(/No tables yet/);
    await user.type(screen.getByLabelText("Table number"), "12");
    await user.click(screen.getByRole("button", { name: "Create table" }));
    expect(createTable).toHaveBeenCalledWith("a", { number: 12 });
    await screen.findByText("Table 12");
    expect(screen.getByText("Code: T12")).toBeInTheDocument();
    expect(screen.getByLabelText("Table number")).toHaveValue("");
  },
);
it.each(["MANAGER", "CASHIER", "KITCHEN"] as const)(
  "denies %s without fetching tables",
  (role) => {
    setup(role);
    expect(screen.getByRole("alert")).toHaveTextContent(/owner or admin/);
    expect(listTables).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Create table" }),
    ).not.toBeInTheDocument();
  },
);
it.each(["", "0", "-1", "1.5", "10000", "abc"])(
  "rejects invalid input %j and focuses the field",
  async (value) => {
    setup();
    await screen.findByText(/No tables yet/);
    const input = screen.getByLabelText("Table number");
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Create table" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/whole table number/);
    expect(input).toHaveFocus();
    expect(createTable).not.toHaveBeenCalled();
  },
);
it("retains the draft on duplicate rejection", async () => {
  vi.mocked(createTable).mockRejectedValue({
    isAxiosError: true,
    response: { status: 409, data: {} },
  });
  setup();
  await screen.findByText(/No tables yet/);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Table number"), "12");
  await user.click(screen.getByRole("button", { name: "Create table" }));
  await screen.findByText(/already exists/);
  expect(screen.getByLabelText("Table number")).toHaveValue("12");
});
it("blocks repeated creation while pending", async () => {
  let resolve!: (result: CreateTableResponse) => void;
  vi.mocked(createTable).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  setup();
  await screen.findByText(/No tables yet/);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Table number"), "12");
  await user.dblClick(screen.getByRole("button", { name: "Create table" }));
  expect(createTable).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  vi.mocked(listTables).mockResolvedValue({ tables: [table] });
  resolve({ table });
  await screen.findByText("Table 12");
});
it("requires a successful refresh after an uncertain save", async () => {
  vi.mocked(createTable).mockRejectedValue({ isAxiosError: true });
  setup();
  await screen.findByText(/No tables yet/);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Table number"), "12");
  await user.click(screen.getByRole("button", { name: "Create table" }));
  await screen.findByText(/confirm creation/);
  expect(screen.getByRole("button", { name: "Create table" })).toBeDisabled();
  vi.mocked(listTables).mockRejectedValueOnce(new Error("offline"));
  await user.click(screen.getByRole("button", { name: "Refresh tables" }));
  await screen.findByText(/couldn’t load tables/);
  expect(screen.getByRole("button", { name: "Create table" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh tables" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Create table" })).toBeEnabled(),
  );
});
it("blocks creation after access is revoked", async () => {
  vi.mocked(createTable).mockRejectedValue({
    isAxiosError: true,
    response: { status: 403, data: {} },
  });
  setup();
  await screen.findByText(/No tables yet/);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Table number"), "12");
  await user.click(screen.getByRole("button", { name: "Create table" }));
  await screen.findByText(/Your access changed/);
  expect(screen.getByRole("button", { name: "Create table" })).toBeDisabled();
});
it("does not place a late creation into another shop", async () => {
  let resolve!: (result: CreateTableResponse) => void;
  vi.mocked(createTable).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = setup();
  await screen.findByText(/No tables yet/);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Table number"), "12");
  await user.click(screen.getByRole("button", { name: "Create table" }));
  view.rerender(view.page("b"));
  await screen.findByText(/Create and view tables for Cafe b/);
  resolve({ table });
  await waitFor(() =>
    expect(listTables).toHaveBeenCalledWith("b", expect.any(AbortSignal)),
  );
  expect(screen.queryByText("Table 12")).not.toBeInTheDocument();
  expect(view.client.getQueryData(tablesKey("user-a", "b"))).toEqual({
    tables: [],
  });
});
