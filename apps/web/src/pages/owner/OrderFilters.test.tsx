import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CurrentUserResponse, UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getActiveOrders } from "../../features/orders/active-orders";
import { getCompletedOrders } from "../../features/orders/completed-orders";
import { getCancelledOrders } from "../../features/orders/cancelled-orders";
import { ActiveOrdersPage } from "./ActiveOrdersPage";
import { CompletedOrdersPage } from "./CompletedOrdersPage";
import { CancelledOrdersPage } from "./CancelledOrdersPage";

vi.mock("../../features/orders/active-orders", async (original) => ({
  ...(await original<typeof import("../../features/orders/active-orders")>()),
  getActiveOrders: vi.fn(),
}));
vi.mock("../../features/orders/completed-orders", async (original) => ({
  ...(await original<
    typeof import("../../features/orders/completed-orders")
  >()),
  getCompletedOrders: vi.fn(),
}));
vi.mock("../../features/orders/cancelled-orders", async (original) => ({
  ...(await original<
    typeof import("../../features/orders/cancelled-orders")
  >()),
  getCancelledOrders: vi.fn(),
}));
const pages = {
  active: ActiveOrdersPage,
  completed: CompletedOrdersPage,
  cancelled: CancelledOrdersPage,
};
const requests = {
  active: vi.mocked(getActiveOrders),
  completed: vi.mocked(getCompletedOrders),
  cancelled: vi.mocked(getCancelledOrders),
};
type View = keyof typeof pages;
beforeEach(() => {
  vi.resetAllMocks();
  for (const request of Object.values(requests))
    request.mockResolvedValue({ orders: [], nextCursor: null });
});
afterEach(cleanup);
function setup(view: View) {
  const Page = pages[view];
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserKey, {
    user: { id: "owner-a" },
  } as CurrentUserResponse);
  const page = (shopId = "a", role: UserMembership["role"] = "OWNER") => (
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider
        value={{
          id: "member",
          shopId,
          role,
          shop: { id: shopId, name: "Cafe", slug: "cafe", isActive: true },
        }}
      >
        <Page />
      </ActiveShopContext.Provider>
    </QueryClientProvider>
  );
  return { ...render(page()), page, client };
}
const change = (label: string, value: string) => {
  const control = screen.getByLabelText(label, { exact: true });
  if (control.getAttribute("role") === "combobox") {
    const labels: Record<string, string> = {
      DINE_IN: "Dine-in",
      TAKEOUT: "Takeout",
      READY: "Ready",
      GCASH_MANUAL: "GCash (manual)",
      CARD_MANUAL: "Card (manual)",
    };
    fireEvent.click(control);
    fireEvent.click(
      screen.getByRole("option", { name: labels[value] }),
    );
  } else fireEvent.change(control, { target: { value } });
};
const apply = () =>
  fireEvent.submit(screen.getByRole("form", { name: "Filter orders" }));
const search = (term: string) => {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: term } });
  fireEvent.submit(screen.getByRole("search"));
};
const open = () =>
  fireEvent.click(screen.getByText("Filters", { selector: "summary" }));

describe.each(["active", "completed", "cancelled"] as const)(
  "%s order filters",
  (view) => {
    it("applies trimmed table, type and business dates with search, then clears them independently", async () => {
      setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      search("ORD");
      await screen.findByText("No matching orders");
      open();
      change("Order type", "DINE_IN");
      change("Table label", "  Patio %_  ");
      change("From date", "2026-10-16");
      change("To date", "2026-10-16");
      expect(requests[view]).toHaveBeenCalledTimes(2);
      apply();
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "a",
          null,
          expect.any(AbortSignal),
          "ORD",
          {
            mode: "DINE_IN",
            table: "Patio %_",
            from: "2026-10-16",
            to: "2026-10-16",
          },
        ),
      );
      expect(screen.getByText(/Applied:.*Dine-in.*Patio %_/)).toBeVisible();
      expect(
        screen.getByText(
          new RegExp(
            `Dates use ${view === "completed" ? "completion" : "placement"} time in Manila`,
          ),
        ),
      ).toBeVisible();
      search("ORD-000042");
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "a",
          null,
          expect.any(AbortSignal),
          "ORD-000042",
          expect.objectContaining({ mode: "DINE_IN", table: "Patio %_" }),
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "a",
          null,
          expect.any(AbortSignal),
          "ORD-000042",
          {},
        ),
      );
      expect(screen.getByRole("searchbox")).toHaveValue("ORD-000042");
    });
    it("retains filters during paging and refresh, resetting the cursor for changed values", async () => {
      requests[view].mockResolvedValue({ orders: [], nextCursor: "next" });
      setup(view);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
      );
      open();
      change("Order type", "TAKEOUT");
      apply();
      await screen.findByText("No matching orders");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("No matching orders on this page");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        "next",
        expect.any(AbortSignal),
        "",
        { mode: "TAKEOUT" },
      );
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await screen.findByText("No matching orders");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "",
        { mode: "TAKEOUT" },
      );
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("No matching orders on this page");
      change("Order type", "DINE_IN");
      apply();
      await screen.findByText("No matching orders");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "",
        { mode: "DINE_IN" },
      );
      expect(
        requests[view].mock.calls.some(
          (call) => call[1] === "next" && call[4]?.mode === "DINE_IN",
        ),
      ).toBe(false);
    });
    it("rejects reversed dates locally and clears an incompatible table when selecting takeout", async () => {
      setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      open();
      change("From date", "2026-10-17");
      change("To date", "2026-10-16");
      apply();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "From date on or before the To date",
      );
      expect(requests[view]).toHaveBeenCalledTimes(1);
      change("To date", "2026-10-17");
      change("Table label", "Patio");
      change("Order type", "TAKEOUT");
      expect(screen.getByLabelText("Table label")).toBeDisabled();
      expect(screen.getByLabelText("Table label")).toHaveValue("");
      apply();
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "a",
          null,
          expect.any(AbortSignal),
          "",
          { mode: "TAKEOUT", from: "2026-10-17", to: "2026-10-17" },
        ),
      );
    });
    it("preserves filters on failure/retry and resets them across shops and roles", async () => {
      const rendered = setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      open();
      requests[view].mockRejectedValueOnce(new Error("offline"));
      change("Order type", "TAKEOUT");
      apply();
      await screen.findByRole("alert");
      expect(
        screen.getByRole("combobox", { name: "Order type" }),
      ).toHaveTextContent("Takeout");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await screen.findByText("No matching orders");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "",
        { mode: "TAKEOUT" },
      );
      rendered.rerender(rendered.page("b"));
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "b",
          null,
          expect.any(AbortSignal),
          "",
          {},
        ),
      );
      expect(
        screen.getByRole("combobox", { name: "Order type" }),
      ).toHaveTextContent("All order types");
      rendered.rerender(rendered.page("b", "CASHIER"));
      expect(
        screen.queryByText("Filters", { selector: "summary" }),
      ).not.toBeInTheDocument();
    });
  },
);

it("offers useful active statuses and every recorded payment method", async () => {
  setup("active");
  await waitFor(() => expect(requests.active).toHaveBeenCalledTimes(1));
  open();
  change("Status", "READY");
  change("Payment method", "GCASH_MANUAL");
  apply();
  await waitFor(() =>
    expect(requests.active).toHaveBeenLastCalledWith(
      "a",
      null,
      expect.any(AbortSignal),
      "",
      { status: "READY", paymentMethod: "GCASH_MANUAL" },
    ),
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Payment method" }));
  expect(
    screen.getByRole("option", { name: "No payment recorded" }),
  ).toBeInTheDocument();
});
it("keeps fulfilled/rejected status fixed and omits irrelevant payment choices", async () => {
  const completed = setup("completed");
  await waitFor(() => expect(requests.completed).toHaveBeenCalledTimes(1));
  open();
  expect(
    screen.queryByRole("combobox", { name: "Status" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "No payment recorded" }),
  ).not.toBeInTheDocument();
  change("Payment method", "CARD_MANUAL");
  apply();
  await waitFor(() =>
    expect(requests.completed).toHaveBeenLastCalledWith(
      "a",
      null,
      expect.any(AbortSignal),
      "",
      { paymentMethod: "CARD_MANUAL" },
    ),
  );
  completed.unmount();
  setup("cancelled");
  await waitFor(() => expect(requests.cancelled).toHaveBeenCalledTimes(1));
  open();
  expect(
    screen.queryByRole("combobox", { name: "Status" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Payment method" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Unpaid")).toBeVisible();
});
