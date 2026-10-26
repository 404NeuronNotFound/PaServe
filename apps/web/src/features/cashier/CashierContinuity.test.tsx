import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import type {
  CurrentUserResponse,
  UserMembership,
  VerifyOrderQrResponse,
} from "@paserve/contracts";
import { ProtectedRoute } from "../auth/components/ProtectedRoute";
import { currentUserKey, getCurrentUser } from "../auth/api/session";
import { ActiveShopRoute } from "../shops/ActiveShopRoute";
import { getShopMembership } from "../shops/api/context";
import { CashierRoute } from "./CashierRoute";
import { CashierPage } from "../../pages/cashier/CashierPage";
import { lookupCashPayment, reviewCashPayment } from "./cash-payment";
import { lookupOrderNumber } from "./order-qr";
import { cashierLine } from "../../test/cashier-fixtures";

vi.mock("../auth/api/session", async (original) => ({
  ...(await original<typeof import("../auth/api/session")>()),
  getCurrentUser: vi.fn(),
}));
vi.mock("../shops/api/context", () => ({ getShopMembership: vi.fn() }));
vi.mock("./cash-payment", async (original) => ({
  ...(await original<typeof import("./cash-payment")>()),
  lookupCashPayment: vi.fn(),
  reviewCashPayment: vi.fn(),
}));
vi.mock("./order-qr", async (original) => ({
  ...(await original<typeof import("./order-qr")>()),
  lookupOrderNumber: vi.fn(),
}));
vi.mock("../orders/new-order-events", () => ({
  subscribeNewOrders: vi.fn(() => vi.fn()),
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));

const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const membership: UserMembership = {
  id: "membership",
  shopId,
  role: "CASHIER",
  shop: { id: shopId, name: "Cafe", slug: "cafe", isActive: true },
};
const account: CurrentUserResponse = {
  user: {
    id: "user",
    email: "cashier@example.com",
    firstName: null,
    lastName: null,
    createdAt: "2026-10-26T00:00:00Z",
    memberships: [membership],
  },
};
const order: VerifyOrderQrResponse["order"] = {
  id: "e47f6994-a303-4a7b-87b0-2386d5198828",
  shopId,
  orderNumber: "ORD-000042",
  mode: "TAKEOUT",
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  reviewVersion: "a".repeat(64),
  currency: "PHP",
  totalPrice: "135.50",
  tableNumber: null,
  items: [cashierLine],
};
beforeEach(() => {
  vi.clearAllMocks();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  vi.mocked(getCurrentUser).mockResolvedValue(account);
  vi.mocked(getShopMembership).mockResolvedValue(membership);
  vi.mocked(lookupCashPayment).mockResolvedValue({ order, payment: null });
  vi.mocked(lookupOrderNumber).mockResolvedValue(order);
  vi.mocked(reviewCashPayment).mockResolvedValue({ order, payment: null });
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserKey, account);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/shops/${shopId}/cashier`]}>
        <Routes>
          <Route
            element={
              <ProtectedRoute>
                <Outlet />
              </ProtectedRoute>
            }
          >
            <Route path="/app/shops/:shopId" element={<ActiveShopRoute />}>
              <Route path="cashier" element={<CashierRoute />}>
                <Route index element={<CashierPage />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
async function returnToTab() {
  await act(async () => {
    focusManager.setFocused(false);
    onlineManager.setOnline(false);
  });
  await act(async () => {
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
}
it("keeps the searched order and review step through repeated tab returns and reconnects", async () => {
  const actor = setup();
  await actor.type(
    await screen.findByLabelText("Find by order number"),
    "ORD-000042",
  );
  await actor.click(screen.getByRole("button", { name: "Find order" }));
  const review = await screen.findByRole("heading", { name: "Review order" });
  const accessChecks = vi.mocked(getShopMembership).mock.calls.length;
  const sessionChecks = vi.mocked(getCurrentUser).mock.calls.length;
  for (let i = 0; i < 3; i++) await returnToTab();
  expect(await screen.findByRole("heading", { name: "Review order" })).toBe(
    review,
  );
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
  expect(
    screen.queryByLabelText("Find by order number"),
  ).not.toBeInTheDocument();
  expect(vi.mocked(getShopMembership).mock.calls.length).toBeGreaterThan(
    accessChecks,
  );
  expect(vi.mocked(getCurrentUser).mock.calls.length).toBeGreaterThan(
    sessionChecks,
  );
});
it("keeps the payment amount and current payment step while the order refreshes in place", async () => {
  const actor = setup();
  await actor.type(
    await screen.findByLabelText("Find by order number"),
    "ORD-000042",
  );
  await actor.click(screen.getByRole("button", { name: "Find order" }));
  await actor.click(
    await screen.findByRole("button", { name: "Confirm and pay" }),
  );
  const amount = await screen.findByLabelText("Amount received (PHP)");
  await waitFor(() => expect(amount).toBeEnabled());
  await actor.type(amount, "200");
  const reviews = vi.mocked(reviewCashPayment).mock.calls.length;
  await returnToTab();
  expect(screen.getByLabelText("Amount received (PHP)")).toBe(amount);
  expect(amount).toHaveValue("200");
  await waitFor(() => expect(amount).toBeVisible());
  await waitFor(() => expect(amount).toHaveFocus());
  expect(
    screen.queryByLabelText("Find by order number"),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(vi.mocked(reviewCashPayment).mock.calls.length).toBeGreaterThan(
      reviews,
    ),
  );
});
it("hides a payment draft on a failed session check and restores it after retry", async () => {
  const actor = setup();
  await actor.type(
    await screen.findByLabelText("Find by order number"),
    "ORD-000042",
  );
  await actor.click(screen.getByRole("button", { name: "Find order" }));
  await actor.click(
    await screen.findByRole("button", { name: "Confirm and pay" }),
  );
  const amount = await screen.findByLabelText("Amount received (PHP)");
  await waitFor(() => expect(amount).toBeEnabled());
  await actor.type(amount, "200");
  vi.mocked(getCurrentUser).mockRejectedValue(
    new Error("connection unavailable"),
  );
  await returnToTab();
  await screen.findByRole("button", { name: "Try again" });
  expect(amount).not.toBeVisible();
  expect(amount).toHaveValue("200");
  vi.mocked(getCurrentUser).mockResolvedValue(account);
  await actor.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(amount).toBeVisible());
  expect(screen.getByLabelText("Amount received (PHP)")).toBe(amount);
  expect(amount).toHaveValue("200");
});
