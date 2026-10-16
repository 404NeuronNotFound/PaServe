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
import { MemoryRouter } from "react-router-dom";
import {
  SALES_PAYMENT_METHODS,
  salesBusinessDayBounds,
  type CurrentUserResponse,
  type UserMembership,
  type RecentSalesOrder,
} from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import { getDailySales } from "../../features/orders/daily-sales";
import { SalesDashboardPage } from "./SalesDashboardPage";

vi.mock("../../features/orders/daily-sales", () => ({
  getDailySales: vi.fn(),
}));

const breakdown = (totalSales = "0.30", orders = 2) =>
  SALES_PAYMENT_METHODS.map((paymentMethod) => ({
    paymentMethod,
    orders: paymentMethod === "CASH" ? orders : 0,
    totalSales: paymentMethod === "CASH" ? totalSales : "0.00",
  }));

const recentOrder = (
  changes: Partial<RecentSalesOrder> = {},
): RecentSalesOrder => ({
  id: "e47f6994-a303-4a7b-87b0-2386d5198828",
  shopId: "a",
  orderNumber: "ORD-000042",
  status: "CONFIRMED",
  paymentStatus: "PAID",
  preparationStatus: "COMPLETED",
  currency: "PHP",
  totalPrice: "0.20",
  completedAt: "2026-10-16T00:05:00.000Z",
  ...changes,
});

it.each(["OWNER", "ADMIN", "MANAGER"] as const)(
  "shows recent saved status, amount and Manila time for %s with permitted links",
  async (role) => {
    vi.mocked(getDailySales).mockResolvedValueOnce({
      shopId: "a",
      businessDate: "2026-10-16",
      ...salesBusinessDayBounds("2026-10-16")!,
      timezone: "Asia/Manila",
      currency: "PHP",
      totalSales: "0.30",
      completedOrders: 2,
      itemsSold: 7,
      paymentBreakdown: breakdown(),
      recentOrders: [
        recentOrder(),
        recentOrder({
          id: "b47f6994-a303-4a7b-87b0-2386d5198828",
          orderNumber: "ORD-000041",
          totalPrice: "0.10",
          completedAt: "2026-10-16T00:01:00.000Z",
        }),
      ],
    });
    setup(role);
    const list = await screen.findByRole("list", {
      name: "Recent completed orders, newest first",
    });
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("ORD-000042");
    expect(entries[0]).toHaveTextContent("Completed · Paid");
    expect(within(entries[0]).getByText("₱0.20")).toBeVisible();
    expect(
      within(entries[0]).getByText(/Oct 16, 2026.*08:05:00/),
    ).toHaveAttribute("dateTime", "2026-10-16T00:05:00.000Z");
    if (role === "OWNER") {
      expect(
        within(entries[0]).getByRole("link", { name: "ORD-000042" }),
      ).toHaveAttribute(
        "href",
        "/app/shops/a/orders/e47f6994-a303-4a7b-87b0-2386d5198828",
      );
      expect(
        screen.getByRole("link", { name: "View completed orders" }),
      ).toHaveAttribute("href", "/app/shops/a/orders/completed");
    } else {
      expect(within(list).queryByRole("link")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("link", { name: "View completed orders" }),
      ).not.toBeInTheDocument();
    }
  },
);

it.each([
  ["0.00", 0, "₱0.00"],
  ["10.00", 3, "₱3.33"],
  ["10.01", 3, "₱3.34"],
  ["1.99", 2, "₱1.00"],
  ["10000000060.32", 37, "₱270,270,271.90"],
])(
  "renders mathematically correct currency for %s / %i",
  async (totalSales, completedOrders, expected) => {
    vi.mocked(getDailySales).mockResolvedValueOnce({
      shopId: "a",
      businessDate: "2026-10-16",
      ...salesBusinessDayBounds("2026-10-16")!,
      timezone: "Asia/Manila",
      currency: "PHP",
      totalSales,
      paymentBreakdown: breakdown(totalSales, completedOrders),
      completedOrders,
      itemsSold: completedOrders * 2,
      recentOrders: [],
    });
    setup();
    const card = await screen.findByRole("article", {
      name: "Average Order Value",
    });
    expect(within(card).getByText(expected)).toBeVisible();
  },
);

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
        <MemoryRouter>
          <SalesDashboardPage />
        </MemoryRouter>
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
    itemsSold: 7,
    recentOrders: [],
    totalSales: "0.30",
    paymentBreakdown: breakdown(),
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
    expect(
      await screen.findByText("₱0.30", { selector: ".sales-amount" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Business date")).toHaveValue("2026-10-16");
    expect(screen.getByText("Today’s Sales")).toBeVisible();
    expect(screen.getByText(/Midnight inclusive/)).toBeVisible();
    expect(
      within(screen.getByRole("article", { name: "Items Sold" })).getByText(
        "7",
      ),
    ).toBeVisible();
    expect(
      within(
        screen.getByRole("article", { name: "Average Order Value" }),
      ).getByText("₱0.15"),
    ).toBeVisible();
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
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
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
  expect(
    screen.queryByText("₱0.30", { selector: ".sales-amount" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Items Sold" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Average Order Value" }),
  ).not.toBeInTheDocument();
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
      itemsSold: 0,
      recentOrders: [],
      totalSales: "0.00",
      paymentBreakdown: breakdown("0.00", 0),
    }),
  );
  expect(
    (await screen.findAllByText("₱0.00", { selector: ".sales-amount" }))[0],
  ).toBeVisible();
  expect(
    within(
      screen.getByRole("article", { name: "Average Order Value" }),
    ).getByText("₱0.00"),
  ).toBeVisible();
  expect(screen.getByText(/No eligible completed orders/)).toBeVisible();
  expect(screen.getByText("Gross Sales")).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Recent Orders" })).getByText(
      "No completed orders for this business day.",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Items Sold" })).getByText("0"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Number of Orders" })).getByText(
      "0",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  expect(
    await screen.findByText("₱0.30", { selector: ".sales-amount" }),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Number of Orders" })).getByText(
      "2",
    ),
  ).toBeVisible();
});
it("hides a previous total on refresh failure and allows retry", async () => {
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  vi.mocked(getDailySales).mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh",
  );
  expect(
    screen.queryByRole("region", { name: "Recent Orders" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Items Sold" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Average Order Value" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("₱0.30", { selector: ".sales-amount" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Number of Orders" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("₱0.30", { selector: ".sales-amount" }),
  ).toBeVisible();
});
it("hides totals when report access is revoked", async () => {
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  vi.mocked(getDailySales).mockRejectedValueOnce(
    new AxiosError("denied", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 403,
    } as never),
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "access to this shop’s sales reports is unavailable",
  );
  expect(
    screen.queryByRole("region", { name: "Recent Orders" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Items Sold" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Average Order Value" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("₱0.30", { selector: ".sales-amount" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("article", { name: "Number of Orders" }),
  ).not.toBeInTheDocument();
});
it("does not retain another shop's total or date selection", async () => {
  const view = setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
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
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
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

it("shows totals and order counts for all four methods, including zero-value payments", async () => {
  vi.mocked(getDailySales).mockResolvedValueOnce({
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    totalSales: "600.00",
    completedOrders: 7,
    itemsSold: 10,
    recentOrders: [],
    paymentBreakdown: [
      { paymentMethod: "CASH", orders: 2, totalSales: "100.00" },
      { paymentMethod: "GCASH_MANUAL", orders: 1, totalSales: "200.00" },
      { paymentMethod: "CARD_MANUAL", orders: 3, totalSales: "300.00" },
      { paymentMethod: "OTHER", orders: 1, totalSales: "0.00" },
    ],
  });
  setup();
  const region = await screen.findByRole("region", {
    name: "Payment Breakdown",
  });
  const table = within(region).getByRole("table", {
    name: "Sales and order counts by payment method",
  });
  for (const [label, count, amount] of [
    ["Cash", "2", "₱100.00"],
    ["GCash (manual)", "1", "₱200.00"],
    ["Card (manual)", "3", "₱300.00"],
    ["Other", "1", "₱0.00"],
  ]) {
    const row = within(table).getByRole("row", {
      name: `${label} ${count} ${amount}`,
    });
    expect(row).toBeVisible();
  }
});

it("displays the full eligible order count and refreshes it with the sales total", async () => {
  vi.mocked(getDailySales).mockResolvedValueOnce({
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    completedOrders: 1234,
    itemsSold: 3456,
    recentOrders: [],
    totalSales: "0.00",
    paymentBreakdown: breakdown("0.00", 1234),
  });
  setup();
  expect(
    await screen.findByText("1,234", { selector: ".sales-amount" }),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Items Sold" })).getByText(
      "3,456",
    ),
  ).toBeVisible();
  expect(
    screen.getAllByText("₱0.00", { selector: ".sales-amount" }),
  ).toHaveLength(2);
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
    itemsSold: 3458,
    recentOrders: [],
    totalSales: "1.00",
    paymentBreakdown: breakdown("1.00", 1235),
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  expect(
    await screen.findByText("1,235", { selector: ".sales-amount" }),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Items Sold" })).getByText(
      "3,458",
    ),
  ).toBeVisible();
  expect(
    screen.getByText("₱1.00", { selector: ".sales-amount" }),
  ).toBeVisible();
});
