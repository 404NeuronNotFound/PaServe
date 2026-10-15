import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { PublicMenuPage } from "./PublicMenuPage";
import { subscribeOrderStream } from "../../features/orders/new-order-events";
import { api } from "../../lib/api/client";
import { useCustomerTables } from "../../features/shops/customer-table";
import { useCart, cartCheckoutRequest } from "../../features/cart/cart";

vi.mock("../../features/orders/new-order-events", () => ({subscribeOrderStream: vi.fn(() => vi.fn())}));
vi.mock("../../lib/api/client", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));
const table = {
  shopSlug: "cafe",
  code: "T12",
  number: "Patio 4",
  checkoutToken: `context.${"a".repeat(43)}`,
};
const menu = {
  shop: { slug: "cafe", name: "Cafe", description: null },
  products: [],
  featuredProducts: [],
  categories: [],
  table,
};
const methods = ["showModal", "close"] as const;
const descriptors = methods.map((key) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, key),
);
beforeEach(() => {
  vi.resetAllMocks();
  useCustomerTables.setState({ codes: {}, resolved: {} });
  useCart.setState({ shops: {} });
  vi.mocked(api.get).mockResolvedValue({ data: menu });
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
  methods.forEach((key, index) => {
    const original = descriptors[index];
    if (original)
      Object.defineProperty(HTMLDialogElement.prototype, key, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  });
  useCustomerTables.setState({ codes: {}, resolved: {} });
});
function setup(
  path = "/cafe/table/T12",
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Link to="/cafe/table/T13">Scan another table</Link>
        <Link to="/other">Other shop</Link>
        <Routes>
          <Route
            path="/:shopSlug/table/:tableCode"
            element={<PublicMenuPage />}
          />
          <Route path="/:shopSlug" element={<PublicMenuPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("scanning opens the table menu and carries the context into the cart and prepared checkout", async () => {
  setup();
  await screen.findByRole("heading", { name: "Cafe", level: 1 });
  expect(api.get).toHaveBeenCalledWith(
    "/menu/cafe/table/T12",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(screen.getByText("Ordering for Table Patio 4")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View cart (0)" }));
  expect(
    within(screen.getByRole("dialog")).getByText("Ordering for Table Patio 4"),
  ).toBeInTheDocument();
  expect(cartCheckoutRequest(useCart.getState().shops, "cafe").tableCode).toBe(
    "T12",
  );
  expect(screen.queryByLabelText(/table number/i)).not.toBeInTheDocument();
});
it("restores a remembered code on a plain menu visit and revalidates it", async () => {
  useCustomerTables.setState({ codes: { cafe: "T12" }, resolved: {} });
  setup("/cafe");
  await screen.findByText("Ordering for Table Patio 4");
  expect(api.get).toHaveBeenCalledWith(
    "/menu/cafe/table/T12",
    expect.anything(),
  );
  expect(cartCheckoutRequest({}, "cafe").tableCode).toBe("T12");
});
it("shows the scanned table as context, rather than the pickup destination, after selecting takeout", async () => {
  setup();
  await screen.findByText("Ordering for Table Patio 4");
  fireEvent.click(screen.getByRole("button", { name: "View cart (0)" }));
  const cart = screen.getByRole("dialog");
  fireEvent.click(
    within(cart).getByRole("radio", { name: "Takeout / pickup" }),
  );
  expect(
    within(cart).getByRole("status", { name: "Current table" }),
  ).toHaveTextContent("Scanned Table Patio 4");
  expect(
    within(cart).queryByText("Ordering for Table Patio 4"),
  ).not.toBeInTheDocument();
  expect(
    within(cart).getByRole("button", { name: "Review order" }),
  ).toBeDisabled();
  fireEvent.click(within(cart).getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "View cart (0)" }));
  expect(
    within(screen.getByRole("dialog")).getByRole("radio", {
      name: "Takeout / pickup",
    }),
  ).toBeChecked();
});
it.each(["/cafe/table/T12", "/cafe"])(
  "lets customers explicitly browse for pickup after an unavailable remembered/scanned table: %s",
  async (path) => {
    useCustomerTables.setState({ codes: { cafe: "T12" }, resolved: {} });
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).includes("/table/"))
        throw new AxiosError("unavailable", "404", undefined, undefined, {
          status: 404,
          statusText: "Not Found",
          data: {},
          headers: {},
          config: { headers: new AxiosHeaders() },
        });
      return { data: { ...menu, table: undefined } };
    });
    setup(path);
    await screen.findByRole("heading", { name: "Table menu unavailable" });
    fireEvent.click(screen.getByRole("button", { name: "Browse for pickup" }));
    await screen.findByRole("heading", { name: "Cafe", level: 1 });
    fireEvent.click(screen.getByRole("button", { name: "View cart (0)" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("radio", {
        name: "Takeout / pickup",
      }),
    ).toBeChecked();
    expect(useCustomerTables.getState().codes.cafe).toBeUndefined();
    expect(api.get).toHaveBeenLastCalledWith("/menu/cafe", expect.anything());
  },
);
it("keeps table context while browsing product details, adding to cart, and preparing selections", async () => {
  const product = {
    id: "coffee",
    categoryId: null,
    name: "Coffee",
    slug: "coffee",
    description: null,
    imageUrl: null,
    price: "10.00",
    status: "AVAILABLE",
    isOrderable: true,
    isFeatured: false,
    sortOrder: 0,
  };
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: String(url).endsWith("/products/coffee")
      ? { product, optionGroups: [], variants: [], addOns: [] }
      : { ...menu, products: [product] },
  }));
  vi.mocked(api.post).mockResolvedValue({
    data: {
      productId: "coffee",
      productName: "Coffee",
      currency: "PHP",
      basePrice: "10.00",
      unitPrice: "10.00",
      totalPrice: "10.00",
      quantity: 1,
      variants: [],
      addOns: [],
    },
  });
  setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "View details for Coffee" }),
  );
  const details = screen.getByRole("dialog", { name: "Coffee" });
  const add = await within(details).findByRole("button", {
    name: /Add to cart/,
  });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  fireEvent.click(screen.getByRole("button", { name: "View cart (1)" }));
  expect(
    within(screen.getByRole("dialog")).getByText("Ordering for Table Patio 4"),
  ).toBeInTheDocument();
  expect(cartCheckoutRequest(useCart.getState().shops, "cafe")).toEqual({
    mode: "DINE_IN",
    tableCode: "T12",
    tableToken: table.checkoutToken,
    items: [{ productId: "coffee", quantity: 1, variantIds: [], addOnIds: [] }],
  });
});
it("uses the explicit scanned table instead of a remembered one", async () => {
  useCustomerTables.getState().setResolved({ ...table, code: "T9" });
  setup();
  await screen.findByText("Ordering for Table Patio 4");
  expect(useCustomerTables.getState().codes.cafe).toBe("T12");
});
it("a subsequent scan replaces the context and switching shops does not leak it", async () => {
  setup();
  await screen.findByText("Ordering for Table Patio 4");
  vi.mocked(api.get).mockResolvedValue({
    data: { ...menu, table: { ...table, code: "T13", number: "13" } },
  });
  fireEvent.click(screen.getByRole("link", { name: "Scan another table" }));
  await screen.findByText("Ordering for Table 13");
  expect(cartCheckoutRequest({}, "cafe").tableCode).toBe("T13");
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...menu,
      shop: { ...menu.shop, name: "Other", slug: "other" },
      table: undefined,
    },
  });
  fireEvent.click(screen.getByRole("link", { name: "Other shop" }));
  await screen.findByRole("heading", { name: "Other", level: 1 });
  expect(screen.queryByText(/Ordering for Table/)).not.toBeInTheDocument();
  expect(cartCheckoutRequest({}, "other").tableCode).toBeUndefined();
});
it("invalid/inactive links show unavailable, clear their remembered code, and never fall back to a generic menu", async () => {
  const error = new AxiosError("not found");
  error.response = {
    status: 404,
    statusText: "Not Found",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  };
  vi.mocked(api.get).mockRejectedValue(error);
  useCustomerTables.getState().setResolved(table);
  setup();
  await screen.findByRole("heading", { name: "Table menu unavailable" });
  await waitFor(() =>
    expect(useCustomerTables.getState().codes.cafe).toBeUndefined(),
  );
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: /View cart/ }),
  ).not.toBeInTheDocument();
});
it("rejects a response with the wrong table context", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: { ...menu, table: { ...table, shopSlug: "other" } },
  });
  setup();
  await screen.findByRole("heading", { name: "Table menu unavailable" });
  expect(useCustomerTables.getState().resolved.cafe).toBeUndefined();
});
it("loads the plain menu for a constructor shop without a bogus inherited table code", async () => {
  vi.mocked(api.get).mockResolvedValue({
    data: {
      ...menu,
      shop: { ...menu.shop, slug: "constructor" },
      table: undefined,
    },
  });
  setup("/constructor");
  await screen.findByRole("heading", { name: "Cafe", level: 1 });
  expect(api.get).toHaveBeenCalledWith("/menu/constructor", expect.anything());
});
it("invalidates resolved context during refetch and keeps it blocked on network failure", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  setup("/cafe/table/T12", client);
  await screen.findByText("Ordering for Table Patio 4");
  expect(cartCheckoutRequest({}, "cafe").tableCode).toBe("T12");
  let reject!: (error: Error) => void;
  vi.mocked(api.get).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const refresh = client.refetchQueries({
    queryKey: ["public-menu", "cafe", "table", "T12"],
  });
  await waitFor(() => expect(() => cartCheckoutRequest({}, "cafe")).toThrow());
  expect(screen.getByRole("heading", {name: "Cafe", level: 1})).toBeInTheDocument();
  reject(new Error("offline"));
  await refresh;
  await screen.findByRole("heading", { name: "Table menu unavailable" });
  expect(() => cartCheckoutRequest({}, "cafe")).toThrow();
  expect(useCustomerTables.getState().codes.cafe).toBe("T12");
});
it.each([
  { ...table, code: "../bad" },
  { ...table, number: "\u0000" },
  { ...table, checkoutToken: "malformed" },
])(
  "shows malformed table responses as unavailable without crashing (%j)",
  async (table) => {
    vi.mocked(api.get).mockResolvedValue({ data: { ...menu, table } });
    setup();
    await screen.findByRole("heading", { name: "Table menu unavailable" });
    expect(useCustomerTables.getState().resolved.cafe).toBeUndefined();
  },
);

it("refreshes table-menu availability without unmounting the menu or losing its table", async () => {
  const product = {id: "coffee", categoryId: null, name: "Coffee", slug: "coffee", price: "20.00", description: null, imageUrl: null, status: "AVAILABLE", isOrderable: true, isFeatured: false, sortOrder: 0};
  vi.mocked(api.get).mockResolvedValue({data: {...menu, products: [product]}});
  setup();
  const heading = await screen.findByRole("heading", {name: "Cafe", level: 1});
  const search = screen.getByRole("searchbox");
  fireEvent.change(search,{target: {value: "Coffee"}});
  let finish!: (value: unknown) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => {finish=resolve;}));
  vi.mocked(subscribeOrderStream).mock.calls[0][4]("product_sold_out",{shopSlug:"cafe"});
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole("heading", {name: "Cafe", level: 1})).toBe(heading);
  finish({data: {...menu, products: [{...product,status: "SOLD_OUT",isOrderable:false}]}});
  await screen.findByText("Sold out");
  expect(search).toHaveValue("Coffee");
  expect(useCustomerTables.getState().resolved.cafe).toMatchObject(table);
  expect(api.get).toHaveBeenLastCalledWith("/menu/cafe/table/T12",expect.any(Object));
  vi.mocked(api.get).mockResolvedValue({data: {...menu, products: [product]}});
  vi.mocked(subscribeOrderStream).mock.calls[0][4]("product_available",{shopSlug:"cafe"});
  await waitFor(() => expect(screen.queryByText("Sold out")).not.toBeInTheDocument());
  expect(screen.getByRole("heading", {name: "Cafe", level: 1})).toBe(heading);
  expect(search).toHaveValue("Coffee");
  expect(useCustomerTables.getState().resolved.cafe).toMatchObject(table);

});
