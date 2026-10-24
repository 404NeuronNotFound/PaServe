import { afterEach, beforeEach, expect, it, vi, describe } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import type {
  ActiveOrderSummary,
  CurrentUserResponse,
  UserMembership,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getActiveOrders } from "../../features/orders/active-orders";
import { getCompletedOrders } from "../../features/orders/completed-orders";
import { getCancelledOrders } from "../../features/orders/cancelled-orders";
import { ActiveOrdersPage } from "./ActiveOrdersPage";
import { CompletedOrdersPage } from "./CompletedOrdersPage";
import { CancelledOrdersPage } from "./CancelledOrdersPage";
import { MemoryRouter } from "react-router-dom";

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
const empty = { orders: [], nextCursor: null };
beforeEach(() => {
  vi.resetAllMocks();
  for (const request of Object.values(requests))
    request.mockResolvedValue(empty);
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});
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
      <MemoryRouter>
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
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...render(page()), page, client };
}
function search(value: string) {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search orders" }), {
    target: { value },
  });
  fireEvent.submit(
    screen.getByRole("search", { name: "Search orders in this view" }),
  );
}

describe.each(["active", "completed", "cancelled"] as const)(
  "%s owner search",
  (view) => {
    it("searches automatically after typing pauses without submitting the form", async () => {
      setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: " Patio " },
      });
      expect(requests[view]).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "a",
          null,
          expect.any(AbortSignal),
          "Patio",
          {},
        ),
      );
      expect(
        screen.queryByRole("button", { name: "Search" }),
      ).not.toBeInTheDocument();
    });
    it("attempts an explicit offline refresh and reports failure instead of keeping stale results paused", async () => {
      const { client } = setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled(),
      );
      requests[view].mockRejectedValue(new Error("Offline"));
      onlineManager.setOnline(false);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /couldn’t refresh/,
      );
      expect(
        client
          .getQueryCache()
          .getAll()
          .some((query) => query.state.fetchStatus === "paused"),
      ).toBe(false);
    });
    it("submits trimmed safe text to the server rather than filtering only the loaded page", async () => {
      setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByRole("searchbox"), {
        target: { value: "  pAtIo 2  " },
      });
      expect(requests[view]).toHaveBeenCalledTimes(1);
      fireEvent.submit(screen.getByRole("search"));
      await screen.findByText("No matching orders");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "pAtIo 2",
        {},
      );
      expect(screen.getByRole("searchbox")).toHaveValue("pAtIo 2");
      expect(screen.getByText("Showing matches for “pAtIo 2”.")).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "a",
          null,
          expect.any(AbortSignal),
          "",
          {},
        ),
      );
      expect(screen.getByRole("searchbox")).toHaveFocus();
    });
    it("keeps search during paging/refresh and resets the cursor atomically for a changed term", async () => {
      requests[view].mockResolvedValue({ orders: [], nextCursor: "next" });
      setup(view);
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
      );
      search("ORD");
      await screen.findByText("No matching orders");
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("No matching orders on this page");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        "next",
        expect.any(AbortSignal),
        "ORD",
        {},
      );
      search("Table B");
      await screen.findByText("No matching orders");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "Table B",
        {},
      );
      expect(
        requests[view].mock.calls.some(
          (call) => call[1] === "next" && call[3] === "Table B",
        ),
      ).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(5));
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "Table B",
        {},
      );
    });
    it("keeps a failed search available for retry without reverting to unfiltered data", async () => {
      setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      requests[view].mockRejectedValueOnce(new Error("offline"));
      search("桌 2");
      await screen.findByRole("alert");
      expect(screen.getByRole("searchbox")).toHaveValue("桌 2");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      await screen.findByText("No matching orders");
      expect(requests[view]).toHaveBeenLastCalledWith(
        "a",
        null,
        expect.any(AbortSignal),
        "桌 2",
        {},
      );
    });
    it("validates length locally and clears the query when changing shops or roles", async () => {
      const rendered = setup(view);
      await waitFor(() => expect(requests[view]).toHaveBeenCalledTimes(1));
      search("x".repeat(81));
      expect(screen.getByRole("alert")).toHaveTextContent(
        "at most 80 characters",
      );
      expect(requests[view]).toHaveBeenCalledTimes(1);
      search("Patio");
      await screen.findByText("No matching orders");
      rendered.rerender(rendered.page("b"));
      expect(screen.getByRole("searchbox")).toHaveValue("");
      await waitFor(() =>
        expect(requests[view]).toHaveBeenLastCalledWith(
          "b",
          null,
          expect.any(AbortSignal),
          "",
          {},
        ),
      );
      rendered.rerender(rendered.page("b", "CASHIER"));
      expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    });
  },
);

it("aborts the previous search and ignores a late response after the term changes", async () => {
  let resolveOld!: (value: {
    orders: ActiveOrderSummary[];
    nextCursor: null;
  }) => void;
  const old = new Promise<{ orders: ActiveOrderSummary[]; nextCursor: null }>(
    (resolve) => {
      resolveOld = resolve;
    },
  );
  requests.active.mockImplementation(async (_shop, _cursor, _signal, term) =>
    term === "old" ? old : empty,
  );
  setup("active");
  await waitFor(() => expect(requests.active).toHaveBeenCalledTimes(1));
  search("old");
  await waitFor(() => expect(requests.active).toHaveBeenCalledTimes(2));
  const signal = requests.active.mock.calls[1][2];
  search("new");
  await screen.findByText("No matching orders");
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolveOld({
      orders: [
        {
          id: "old-order",
          shopId: "a",
          orderNumber: "ORD-000099",
          mode: "TAKEOUT",
          tableNumber: null,
          status: "PENDING_CONFIRMATION",
          paymentStatus: "UNPAID",
          preparationStatus: null,
          currency: "PHP",
          totalPrice: "10.00",
          createdAt: "2026-10-16T00:00:00.000Z",
          updatedAt: "2026-10-16T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });
  });
  expect(screen.queryByText("ORD-000099")).not.toBeInTheDocument();
  expect(screen.getByText("Showing matches for “new”.")).toBeVisible();
});
