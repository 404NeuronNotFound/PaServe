import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError } from "axios";
import {
  salesBusinessDayBounds,
  type CurrentUserResponse,
  type UserMembership,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getDailySales } from "../../features/orders/daily-sales";
import { SalesDashboardPage } from "./SalesDashboardPage";

vi.mock("../../features/orders/daily-sales", () => ({
  getDailySales: vi.fn(),
}));
function setup(role: UserMembership["role"] = "OWNER") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserKey, {
    user: { id: "user-a" },
  } as CurrentUserResponse);
  const page = (shopId = "a", nextRole = role) => (
    <QueryClientProvider client={client}>
      <ActiveShopContext.Provider
        value={{
          id: "member",
          shopId,
          role: nextRole,
          shop: { id: shopId, name: "Cafe", slug: "cafe", isActive: true },
        }}
      >
        <SalesDashboardPage />
      </ActiveShopContext.Provider>
    </QueryClientProvider>
  );
  return { ...render(page()), page, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(new Date("2026-10-15T16:00:00.000Z"));
  vi.mocked(getDailySales).mockImplementation(async (shopId, businessDate) => ({
    shopId,
    businessDate,
    ...salesBusinessDayBounds(businessDate)!,
    timezone: "Asia/Manila",
    currency: "PHP",
    completedOrders: 2,
    totalSales: "0.30",
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it.each(["OWNER", "ADMIN", "MANAGER"] as const)(
  "shows today's exact gross total for %s using the Manila date",
  async (role) => {
    setup(role);
    expect(await screen.findByText("₱0.30")).toBeVisible();
    expect(screen.getByLabelText("Business date")).toHaveValue("2026-10-16");
    expect(screen.getByText("Today’s Sales")).toBeVisible();
    expect(screen.getByText(/Midnight inclusive/)).toBeVisible();
    expect(
      within(
        screen.getByRole("article", { name: "Number of Orders" }),
      ).getByText("2"),
    ).toBeVisible();
  },
);
it.each(["CASHIER", "KITCHEN"] as const)(
  "does not request reports for %s",
  (role) => {
    setup(role);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "does not allow access",
    );
    expect(getDailySales).not.toHaveBeenCalled();
  },
);
it("loads the selected day, clears the total while pending, and returns to today", async () => {
  setup();
  await screen.findByText("₱0.30");
  let resolve!: (value: Awaited<ReturnType<typeof getDailySales>>) => void;
  vi.mocked(getDailySales).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.change(screen.getByLabelText("Business date"), {
    target: { value: "2026-10-14" },
  });
  expect(screen.queryByText("₱0.30")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Number of Orders" }),
  ).not.toBeInTheDocument();
  await act(async () =>
    resolve({
      shopId: "a",
      businessDate: "2026-10-14",
      ...salesBusinessDayBounds("2026-10-14")!,
      timezone: "Asia/Manila",
      currency: "PHP",
      completedOrders: 0,
      totalSales: "0.00",
    }),
  );
  expect(await screen.findByText("₱0.00")).toBeVisible();
  expect(screen.getByText(/No eligible completed orders/)).toBeVisible();
  expect(screen.getByText("Gross Sales")).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Number of Orders" })).getByText(
      "0",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(await screen.findByText("₱0.30")).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Number of Orders" })).getByText(
      "2",
    ),
  ).toBeVisible();
});
it("hides a previous total on refresh failure and allows retry", async () => {
  setup();
  await screen.findByText("₱0.30");
  vi.mocked(getDailySales).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh",
  );
  expect(screen.queryByText("₱0.30")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Number of Orders" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("₱0.30")).toBeVisible();
});
it("hides totals when report access is revoked", async () => {
  setup();
  await screen.findByText("₱0.30");
  vi.mocked(getDailySales).mockRejectedValueOnce(
    new AxiosError("denied", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 403,
    } as never),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "access to this shop’s sales reports is unavailable",
  );
  expect(screen.queryByText("₱0.30")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Number of Orders" }),
  ).not.toBeInTheDocument();
});
it("does not retain another shop's total or date selection", async () => {
  const view = setup();
  await screen.findByText("₱0.30");
  fireEvent.change(screen.getByLabelText("Business date"), {
    target: { value: "2026-10-14" },
  });
  await waitFor(() =>
    expect(getDailySales).toHaveBeenCalledWith(
      "a",
      "2026-10-14",
      expect.any(AbortSignal),
    ),
  );
  view.rerender(view.page("b"));
  await waitFor(() =>
    expect(getDailySales).toHaveBeenCalledWith(
      "b",
      "2026-10-16",
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByLabelText("Business date")).toHaveValue("2026-10-16");
});
it("advances the Today view across Manila midnight on focus", async () => {
  setup();
  await screen.findByText("₱0.30");
  vi.setSystemTime(new Date("2026-10-16T16:00:00.000Z"));
  fireEvent(window, new Event("focus"));
  await waitFor(() =>
    expect(getDailySales).toHaveBeenCalledWith(
      "a",
      "2026-10-17",
      expect.any(AbortSignal),
    ),
  );
});

it("displays the full eligible order count and refreshes it with the sales total", async () => {
  vi.mocked(getDailySales).mockResolvedValueOnce({
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    completedOrders: 1234,
    totalSales: "0.00",
  });
  setup();
  expect(await screen.findByText("1,234")).toBeVisible();
  expect(screen.getByText("₱0.00")).toBeVisible();
  expect(
    screen.queryByText("No eligible orders for this business day."),
  ).not.toBeInTheDocument();
  vi.mocked(getDailySales).mockResolvedValueOnce({
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    completedOrders: 1235,
    totalSales: "1.00",
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  expect(await screen.findByText("1,235")).toBeVisible();
  expect(screen.getByText("₱1.00")).toBeVisible();
});
