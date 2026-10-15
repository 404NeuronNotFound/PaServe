import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError } from "axios";
import type { PreparationQueueResponse, UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { getShopMembership } from "../../features/shops/api/context";
import { api } from "../../lib/api/client";
import { KitchenRoute } from "../../features/kitchen/KitchenRoute";
import { KitchenPage } from "./KitchenPage";

vi.mock("../../features/shops/api/context", () => ({ getShopMembership: vi.fn() }));
vi.mock("../../lib/api/client", () => ({ api: { get: vi.fn(), interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } }, AUTH_REQUEST_TIMEOUT_MS: 15000 }));
const member = (role: UserMembership["role"]): UserMembership => ({ id: "m", shopId: "shop-a", role, shop: { id: "shop-a", name: "Cafe A", slug: "cafe-a", isActive: true } });
const ticket = (id = "first", number = "ORD-000001", queuedAt = "2026-10-15T01:00:00.000Z"): PreparationQueueResponse["orders"][number] => ({
  id, shopId: "shop-a", orderNumber: number, mode: "DINE_IN", tableNumber: "Patio 2", currency: "PHP", totalPrice: "150.00", queuedAt, preparationStatus: "QUEUED",
  items: [{ productId: "p", productName: "Iced latte", quantity: 2, currency: "PHP", basePrice: "60.00", unitPrice: "75.00", totalPrice: "150.00", variants: [{ id: "v", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "10.00" }], addOns: [{ id: "a", name: "Oat milk", priceAdjustment: "5.00" }], notes: "No ice, please" }],
});
afterEach(() => vi.resetAllMocks());
function setup(role: UserMembership["role"] = "KITCHEN", orders = [ticket()], nextCursor: string | null = null) {
  vi.mocked(getShopMembership).mockResolvedValue(member(role));
  vi.mocked(api.get).mockResolvedValue({ data: { orders, nextCursor } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["auth", "me"], { user: { id: "user-a" } });
  render(<QueryClientProvider client={client}><ActiveShopContext.Provider value={member("OWNER")}><MemoryRouter initialEntries={["/app/shops/shop-a/kitchen"]}><Routes>
    <Route path="/app/shops/:shopId/kitchen" element={<KitchenRoute />}><Route index element={<KitchenPage />} /></Route>
    <Route path="/login" element={<h1>Sign in</h1>} />
  </Routes></MemoryRouter></ActiveShopContext.Provider></QueryClientProvider>);
  return client;
}
it.each(["KITCHEN", "OWNER", "ADMIN", "MANAGER"] as const)("shows real preparation details for %s", async (role) => {
  setup(role);
  const order = await screen.findByRole("article", { name: "Order ORD-000001" });
  for (const text of ["Table Patio 2", "Dine-in", "Iced latte", "Large", "+ Oat milk", "No ice, please", "2 items"]) expect(within(order).getByText(text)).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith("/shops/shop-a/preparation/queue", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it("denies cashier access even when the outer context is owner", async () => {
  setup("CASHIER");
  expect(await screen.findByRole("heading", { name: "Kitchen access required" })).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});
it("orders tickets chronologically and distinguishes pickup", async () => {
  setup("KITCHEN", [{ ...ticket("later", "ORD-000002", "2026-10-15T02:00:00.000Z"), mode: "TAKEOUT", tableNumber: null }, ticket()]);
  await screen.findByRole("article", { name: "Order ORD-000001" });
  const orders = screen.getAllByRole("article");
  expect(orders[0]).toHaveAccessibleName("Order ORD-000001");
  expect(within(orders[0]).getByText("Oldest ticket")).toBeInTheDocument();
  expect(within(orders[1]).getByText("Pickup")).toBeInTheDocument();
});
it("shows an honest empty state", async () => {
  setup("KITCHEN", []);
  expect(await screen.findByText("A little room to breathe.")).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it("loads the next cursor without duplicating tickets", async () => {
  setup("KITCHEN", [ticket()], "cursor123");
  const more = await screen.findByRole("button", { name: "Load more orders" });
  vi.mocked(api.get).mockResolvedValueOnce({ data: { orders: [ticket(), ticket("second", "ORD-000002")], nextCursor: null } });
  await userEvent.click(more);
  await screen.findByRole("article", { name: "Order ORD-000002" });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(api.get).toHaveBeenLastCalledWith("/shops/shop-a/preparation/queue", expect.objectContaining({ params: { cursor: "cursor123" } }));
});
it("keeps a confirmed paid ticket visible exactly once across repeated refreshes", async () => {
  setup();
  await screen.findByRole("article", { name: "Order ORD-000001" });
  for (let index = 0; index < 3; index++) {
    await userEvent.click(screen.getByRole("button", { name: "Refresh orders" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh orders" })).toBeEnabled());
    expect(screen.getAllByRole("article", { name: "Order ORD-000001" })).toHaveLength(1);
  }
  expect(api.get).toHaveBeenCalledTimes(4);
});
it("keeps tickets with a visible warning after a failed refresh and recovers", async () => {
  setup();
  await screen.findByRole("article");
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Connection lost"));
  await userEvent.click(screen.getByRole("button", { name: "Refresh orders" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("may be out of date");
  expect(screen.getByRole("article")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
it("hides cached tickets immediately when queue access is revoked", async () => {
  const client = setup();
  await screen.findByRole("article");
  const error = new AxiosError("Denied");
  error.response = { status: 403 } as NonNullable<typeof error.response>;
  vi.mocked(api.get).mockRejectedValue(error);
  await act(async () => { await client.invalidateQueries({ queryKey: ["kitchen", "queue"] }); });
  expect(await screen.findByRole("heading", { name: "Kitchen access required" })).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
it.each([
  { shopId: "foreign-shop" }, { preparationStatus: "READY" }, { queuedAt: "invalid" },
  { mode: "DINE_IN", tableNumber: null }, { items: [] }, { totalPrice: "1.00" },
])("rejects an invalid or foreign queue response: %j", async (change) => {
  setup("KITCHEN", [{ ...ticket(), ...change } as ReturnType<typeof ticket>]);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be verified");
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
