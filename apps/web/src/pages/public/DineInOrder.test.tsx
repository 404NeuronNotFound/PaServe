import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DineInOrder } from "./DineInOrder";
import { useCart } from "../../features/cart/cart";
import { useCustomerTables } from "../../features/shops/customer-table";
import { api } from "../../lib/api/client";
vi.mock("../../lib/api/client", () => ({ api: { post: vi.fn() } }));
const table = {
  shopSlug: "cafe",
  code: "T12",
  number: "12",
  checkoutToken: `context.${"a".repeat(43)}`,
};
const quote = {
  productId: "coffee",
  productName: "Coffee",
  currency: "PHP" as const,
  basePrice: "10.00",
  unitPrice: "10.00",
  totalPrice: "10.00",
  quantity: 1,
  variants: [],
  addOns: [],
};
const response = {
  data: {
    order: {
      id: "order-a",
      mode: "DINE_IN",
      status: "PLACED",
      table,
      totalPrice: "12.00",
      currency: "PHP",
      items: [],
      createdAt: "2026-10-12",
    },
  },
};
beforeEach(() => {
  sessionStorage.clear();
  vi.resetAllMocks();
  useCart.setState({ shops: {} });
  useCustomerTables.setState({ codes: {}, resolved: {} });
  useCustomerTables.getState().setResolved(table);
  useCart.getState().add("cafe", quote);
});
it("inherits dine-in and submits only selections, then shows the saved total and clears submitted lines", async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(api.post).toHaveBeenCalledWith(
    "/menu/cafe/orders",
    expect.objectContaining({
      mode: "DINE_IN",
      tableCode: "T12",
      tableToken: table.checkoutToken,
      requestId: expect.any(String),
      items: [
        { productId: "coffee", quantity: 1, variantIds: [], addOnIds: [] },
      ],
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Order placed for Table 12",
  );
  expect(useCart.getState().shops.cafe).toEqual([]);
});
it("keeps the same request after a lost response and across remount, preserving new cart items", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("Network lost"))
    .mockResolvedValueOnce(response);
  const first = render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "not been confirmed",
  );
  const sent = vi.mocked(api.post).mock.calls[0][1];
  first.unmount();
  useCart.getState().add("cafe", quote);
  render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(sent);
  expect(useCart.getState().shops.cafe).toHaveLength(1);
});
it("blocks unresolved table context without submitting", async () => {
  useCustomerTables.getState().beginResolution("cafe", "T12");
  render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Scan your table QR",
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks changed store context instead of ordering for a different table from the display", async () => {
  useCustomerTables.getState().setResolved({ ...table, code: "T13" });
  render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Scan your table QR",
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("requires signed context before attempting checkout", async () => {
  const unsigned = {
    shopSlug: table.shopSlug,
    code: table.code,
    number: table.number,
  };
  useCustomerTables.getState().setResolved(unsigned);
  render(<DineInOrder shopSlug="cafe" table={unsigned} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Scan your table QR",
  );
  expect(api.post).not.toHaveBeenCalled();
});
it("blocks confirmation from another table and preserves the original request", async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Network lost"));
  const first = render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  await screen.findByRole("alert");
  const original = sessionStorage.getItem("paserve-pending-order:v1:cafe");
  first.unmount();
  const other = { ...table, code: "T13", number: "13" };
  useCustomerTables.getState().setResolved(other);
  render(<DineInOrder shopSlug="cafe" table={other} />);
  expect(
    screen.getByRole("button", { name: "Confirm previous order" }),
  ).toBeDisabled();
  expect(screen.getByText(/An order from another table/)).toBeInTheDocument();
  expect(sessionStorage.getItem("paserve-pending-order:v1:cafe")).toBe(
    original,
  );
  expect(api.post).toHaveBeenCalledTimes(1);
});
it("retains expired context and refreshes only the token after rescanning the same table", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 403, data: { code: "TABLE_CONTEXT_INVALID" } },
    })
    .mockResolvedValueOnce(response);
  const first = render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Scan the original table QR",
  );
  const original = vi.mocked(api.post).mock.calls[0][1] as Record<
    string,
    unknown
  >;
  first.unmount();
  const renewed = { ...table, checkoutToken: `fresh.${"b".repeat(43)}` };
  useCustomerTables.getState().setResolved(renewed);
  render(<DineInOrder shopSlug="cafe" table={renewed} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({
    ...original,
    tableToken: renewed.checkoutToken,
  });
  expect(useCart.getState().shops.cafe).toEqual([]);
});
it("retains cart and retry request when the response has an invalid total or wrong shop", async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: {
      order: {
        ...response.data.order,
        totalPrice: "bad",
        table: { ...table, shopSlug: "other" },
      },
    },
  });
  render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "not been confirmed",
  );
  expect(useCart.getState().shops.cafe).toHaveLength(1);
  expect(
    screen.getByRole("button", { name: "Confirm previous order" }),
  ).toBeEnabled();
});
it("preserves cart and permits a fresh attempt after a definitive validation rejection", async () => {
  vi.mocked(api.post).mockRejectedValue({
    isAxiosError: true,
    response: { status: 400 },
  });
  render(<DineInOrder shopSlug="cafe" table={table} />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place dine-in order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be placed",
  );
  expect(useCart.getState().shops.cafe).toHaveLength(1);
  expect(sessionStorage.getItem("paserve-pending-order:v1:cafe")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Place dine-in order" }),
  ).toBeEnabled();
});
