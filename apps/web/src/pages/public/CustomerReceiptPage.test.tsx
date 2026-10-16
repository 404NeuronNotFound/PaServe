import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { CustomerReceiptPage } from "./CustomerReceiptPage";
import { CustomerOrderPage } from "./CustomerOrderPage";
import {
  orderReceipts,
  recoverOrderReceipt,
} from "../../features/cart/order-receipt";
import { cashierLine } from "../../test/cashier-fixtures";

vi.mock("../../lib/api/client", () => ({
  api: { defaults: { baseURL: "/api/v1" } },
}));
vi.mock("../../features/orders/new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));
const id = "e47f6994-a303-4a7b-87b0-2386d5198828";
const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const path = `/menu/cafe/orders/${id}`;
const saved = (mode: "DINE_IN" | "TAKEOUT" = "TAKEOUT") => ({
  order: {
    id,
    shopId,
    orderNumber: "ORD-000042",
    status: "CONFIRMED",
    paymentStatus: "PAID",
    confirmedAt: "2026-10-16T00:01:00Z",
    preparationStatus: "QUEUED",
    updatedAt: "2026-10-16T00:01:00Z",
  },
  receipt: {
    shopSlug: "cafe",
    shopName: "Receipt Cafe",
    id,
    orderNumber: "ORD-000042",
    mode,
    table: mode === "DINE_IN" ? { code: "T1", number: "Patio 2" } : null,
    status: "PENDING_CONFIRMATION",
    currency: "PHP",
    totalPrice: "135.50",
    subtotalPrice: "135.50",
    shopDetails: {
      name: "Receipt Cafe",
      address: "12 Main Street",
      phone: null,
      contactEmail: null,
      website: null,
    },
    items: [cashierLine],
    payment: {
      method: "CASH",
      reference: null,
      description: null,
      amountReceived: "200.00",
      changeDue: "64.50",
    },
    createdAt: "2026-10-16T00:00:00Z",
    paidAt: "2026-10-16T00:01:00Z",
    completedAt: null,
  },
});
const ok = (mode: "DINE_IN" | "TAKEOUT" = "TAKEOUT") => ({
  ok: true,
  status: 200,
  json: async () => saved(mode),
});
const fetchReceipt = vi.fn();
function setup(entry = `${path}/receipt`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/menu/:shopSlug/orders/:orderId/receipt"
          element={<CustomerReceiptPage />}
        />
        <Route
          path="/menu/:shopSlug/orders/:orderId"
          element={<CustomerOrderPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  orderReceipts.clearMemory();
  vi.stubGlobal("fetch", fetchReceipt);
  fetchReceipt.mockResolvedValue(ok());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

it("keeps customer receipts viewable without cashier print controls", async () => {
  setup();
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  expect(screen.queryByRole("button", { name: "Print receipt" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Print layout")).not.toBeInTheDocument();
  expect(screen.getByText("Line total: ₱135.50")).toBeInTheDocument();
});

it.each(["DINE_IN", "TAKEOUT"] as const)(
  "opens the full protected %s receipt using the guest cookie",
  async (mode) => {
    fetchReceipt.mockResolvedValue(ok(mode));
    setup();
    const heading = await screen.findByRole("heading", {
      name: "Receipt ORD-000042",
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("12 Main Street")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "2 × Saved Latte" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(screen.getByText("Oat milk")).toBeInTheDocument();
    expect(
      screen.getByText("Amount received (PHP): ₱200.00"),
    ).toBeInTheDocument();
    expect(screen.getByText("Change (PHP): ₱64.50")).toBeInTheDocument();
    expect(
      screen.getByText("Timezone: Asia/Manila · en-PH"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to menu" })).toHaveAttribute(
      "href",
      mode === "DINE_IN" ? "/cafe/table/T1" : "/menu/cafe",
    );
    expect(fetchReceipt).toHaveBeenCalledWith(
      `/api/v1${path}/status`,
      expect.objectContaining({
        credentials: "include",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      }),
    );
    for (const [, options] of fetchReceipt.mock.calls)
      expect(options.method ?? "GET").toBe("GET");
  },
);
it.each([401, 403, 404])(
  "does not unlock cached receipt details when the API denies access (%s)",
  async (status) => {
    recoverOrderReceipt("cafe", id, saved().receipt);
    fetchReceipt.mockResolvedValue({ ok: false, status });
    setup();
    expect(
      screen.getByRole("heading", { name: "Loading receipt" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Receipt Cafe")).not.toBeInTheDocument();
    await screen.findByRole("heading", { name: "Receipt unavailable" });
    expect(
      screen.queryByRole("region", { name: "Order receipt" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("12 Main Street")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Print receipt" }),
    ).not.toBeInTheDocument();
  },
);
it("clearly labels a saved unpaid receipt without showing payment settlement", async () => {
  const source = saved();
  fetchReceipt.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ...source,
      order: {
        ...source.order,
        status: "PENDING_CONFIRMATION",
        paymentStatus: "UNPAID",
        confirmedAt: null,
        preparationStatus: null,
      },
      receipt: { ...source.receipt, payment: null, paidAt: null },
    }),
  });
  setup();
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  expect(screen.getByText("Unpaid")).toBeInTheDocument();
  expect(
    screen.getByText("No payment method has been recorded."),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Amount received \(PHP\)/)).not.toBeInTheDocument();
});
it("does not display receipt data from a mismatched protected order response", async () => {
  const source = saved();
  fetchReceipt.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      ...source,
      order: { ...source.order, id: "75992537-5d60-4d22-8e1e-60a114644681" },
    }),
  });
  setup();
  await screen.findByRole("heading", { name: "Receipt unavailable" });
  expect(screen.queryByText("12 Main Street")).not.toBeInTheDocument();
});
it.each(["ORD-000042", "invalid"])(
  "does not treat display number or invalid ID %s as receipt proof",
  async (orderId) => {
    setup(`/menu/cafe/orders/${orderId}/receipt`);
    await screen.findByRole("heading", { name: "Receipt unavailable" });
    expect(fetchReceipt).not.toHaveBeenCalled();
  },
);
it("exchanges a fragment token for a guest session and removes it before receipt reads", async () => {
  const token = `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-tracking", shopId, orderId: id, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: Date.parse("2030-01-01T00:00:00Z") })).toString("base64url")}.${"a".repeat(43)}`;
  window.history.replaceState({}, "", `${path}/receipt#tracking=${token}`);
  fetchReceipt.mockImplementation(async (url: string) =>
    url.endsWith("/tracking-session") ? { ok: true, status: 201 } : ok(),
  );
  setup();
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  expect(window.location.hash).toBe("");
  expect(fetchReceipt.mock.calls[0]).toEqual([
    `/api/v1${path}/tracking-session`,
    expect.objectContaining({
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  ]);
  for (const [url] of fetchReceipt.mock.calls)
    expect(String(url)).not.toContain(token);
  for (const link of screen.getAllByRole("link"))
    expect(link.getAttribute("href")).not.toContain(token);
  expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(
    token,
  );
});
it("rechecks access on reload rather than opening the cached receipt immediately", async () => {
  const view = setup();
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  view.unmount();
  orderReceipts.clearMemory();
  fetchReceipt.mockResolvedValue({ ok: false, status: 403 });
  setup();
  await screen.findByRole("heading", { name: "Receipt unavailable" });
  expect(screen.queryByText("12 Main Street")).not.toBeInTheDocument();
});
it("hides a previously verified receipt when access is revoked", async () => {
  setup();
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  fetchReceipt.mockResolvedValue({ ok: false, status: 403 });
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByRole("heading", { name: "Receipt unavailable" });
  expect(screen.queryByText("12 Main Street")).not.toBeInTheDocument();
});
it("retries failed reads without any payment or order mutation", async () => {
  fetchReceipt.mockResolvedValue({ ok: false, status: 500 });
  setup();
  await screen.findByRole("heading", { name: "Receipt unavailable" });
  fetchReceipt.mockResolvedValue(ok());
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  for (const [, options] of fetchReceipt.mock.calls)
    expect(options.method ?? "GET").toBe("GET");
});
it("navigates from tracking to the dedicated receipt and performs a protected read", async () => {
  setup(path);
  await screen.findByRole("link", { name: "View receipt" });
  await userEvent.click(screen.getByRole("link", { name: "View receipt" }));
  await screen.findByRole("heading", { name: "Receipt ORD-000042" });
  await waitFor(() => expect(fetchReceipt).toHaveBeenCalledTimes(2));
  expect(
    screen.queryByRole("heading", { name: "Order confirmed" }),
  ).not.toBeInTheDocument();
});
