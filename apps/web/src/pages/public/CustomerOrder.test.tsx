import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerOrder } from "./CustomerOrder";
import { useCart } from "../../features/cart/cart";
import { useCustomerTables } from "../../features/shops/customer-table";
import { api } from "../../lib/api/client";
vi.mock("../../lib/api/client", () => ({ api: { post: vi.fn() } }));
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
const table = {
  shopSlug: "cafe",
  code: "T12",
  number: "12",
  checkoutToken: `context.${"a".repeat(43)}`,
};
const response = {
  data: {
    order: {
      id: "pickup-a",
      mode: "TAKEOUT",
      status: "PLACED",
      table: null,
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
  useCart.getState().add("cafe", quote);
});
it("defaults a tableless cart to pickup and submits without table fields", async () => {
  vi.mocked(api.post).mockResolvedValue(response);
  render(<CustomerOrder shopSlug="cafe" />);
  expect(screen.getByRole("radio", { name: "Takeout / pickup" })).toBeChecked();
  expect(
    screen.queryByRole("radio", { name: /Dine-in/ }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(api.post).toHaveBeenCalledWith("/menu/cafe/orders", {
    requestId: expect.any(String),
    mode: "TAKEOUT",
    items: [{ productId: "coffee", quantity: 1, variantIds: [], addOnIds: [] }],
  });
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Pickup order placed.",
  );
  expect(useCart.getState().shops.cafe).toEqual([]);
});
it("lets a table customer choose pickup without submitting the remembered table", async () => {
  useCustomerTables.getState().setResolved(table);
  vi.mocked(api.post).mockResolvedValue(response);
  const onModeChange = vi.fn();
  render(
    <CustomerOrder shopSlug="cafe" table={table} onModeChange={onModeChange} />,
  );
  await userEvent.click(
    screen.getByRole("radio", { name: "Takeout / pickup" }),
  );
  expect(onModeChange).toHaveBeenLastCalledWith("TAKEOUT");
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("tableCode");
  expect(vi.mocked(api.post).mock.calls[0][1]).not.toHaveProperty("tableToken");
  expect(useCustomerTables.getState().codes.cafe).toBe("T12");
});
it("does not inherit unresolved table hints when pickup is explicitly selected", async () => {
  useCustomerTables.setState({ codes: { cafe: "T12" }, resolved: {} });
  vi.mocked(api.post).mockResolvedValue(response);
  render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Pickup order placed.",
  );
});
it("restores an uncertain pickup request without changing mode or request ID after a table scan", async () => {
  vi.mocked(api.post)
    .mockRejectedValueOnce(new Error("lost"))
    .mockResolvedValueOnce(response);
  const first = render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  await screen.findByRole("alert");
  const sent = vi.mocked(api.post).mock.calls[0][1];
  first.unmount();
  useCustomerTables.getState().setResolved(table);
  render(<CustomerOrder shopSlug="cafe" table={table} />);
  expect(screen.getByRole("radio", { name: "Takeout / pickup" })).toBeChecked();
  expect(screen.getByRole("radio", { name: /Dine-in/ })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Confirm previous order" }),
  );
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual(sent);
  expect(useCart.getState().shops.cafe).toEqual([]);
});
it("keeps pickup cart and retry request when a response unexpectedly binds a table", async () => {
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...response.data.order, table } },
  });
  render(<CustomerOrder shopSlug="cafe" />);
  await userEvent.click(
    screen.getByRole("button", { name: "Place pickup order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "not been confirmed",
  );
  expect(useCart.getState().shops.cafe).toHaveLength(1);
});
