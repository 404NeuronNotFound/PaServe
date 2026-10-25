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
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
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
import { getCustomSales } from "../../features/orders/custom-sales";
import { TopProducts } from "./TopProducts";
import { PeakHours } from "./PeakHours";
import { AveragePrepTime } from "./AveragePrepTime";
import { SalesTrends } from "./SalesTrends";
import { DailyAnalytics } from "./DailyAnalytics";
import { SalesDashboardPage } from "./SalesDashboardPage";
import { api } from "../../lib/api/client";

vi.mock("../../features/orders/daily-sales", () => ({
  getDailySales: vi.fn(),
}));
vi.mock("../../features/orders/custom-sales", () => ({
  getCustomSales: vi.fn(),
}));
// Daily analytics has its own range, request, and error-state tests.
vi.mock("./DailyAnalytics", () => ({ DailyAnalytics: vi.fn(() => null) }));
vi.mock("./TopProducts", () => ({ TopProducts: vi.fn(() => null) }));
vi.mock("./PeakHours", () => ({ PeakHours: vi.fn(() => null) }));
vi.mock("./AveragePrepTime", () => ({ AveragePrepTime: vi.fn(() => null) }));
vi.mock("./SalesTrends", () => ({ SalesTrends: vi.fn(() => null) }));

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

const customReport = (startDate = "2026-10-15", endDate = "2026-10-17") => ({
  shopId: "a",
  startDate,
  endDate,
  from: salesBusinessDayBounds(startDate)!.from,
  to: salesBusinessDayBounds(endDate)!.to,
  timezone: "Asia/Manila" as const,
  currency: "PHP" as const,
  totalSales: "12.35",
  completedOrders: 2,
  itemsSold: 9,
  paymentBreakdown: breakdown("12.35", 2),
  recentOrders: [
    recentOrder({
      totalPrice: "12.25",
      completedAt: `${endDate}T01:00:00.000Z`,
    }),
    recentOrder({
      id: "b47f6994-a303-4a7b-87b0-2386d5198828",
      orderNumber: "ORD-000041",
      totalPrice: "0.10",
      completedAt: `${startDate}T01:00:00.000Z`,
    }),
  ],
});
it("keeps charts ahead of recent activity and removes duplicate navigation", async () => {
  setup();
  await screen.findByRole("region", { name: "Business overview" });
  expect(
    screen.queryByRole("navigation", { name: "Management shortcuts" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "Sales dashboard sections" }),
  ).not.toBeInTheDocument();
  const activity = screen.getByRole("region", { name: "Recent Orders" });
  expect(
    document
      .getElementById("sales-trends-section")!
      .compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(
    screen.getByText("View payment details").closest("details"),
  ).not.toHaveAttribute("open");
});
it("shows applied-period key figures before charts", async () => {
  setup();
  const overview = await screen.findByRole("region", {
    name: "Business overview",
  });
  expect(overview).toHaveTextContent("October 16, 2026");
  for (const title of ["Number of Orders", "Average Order Value", "Items Sold"])
    expect(
      within(overview).getByRole("heading", { name: title }),
    ).toBeVisible();
  expect(
    overview.compareDocumentPosition(
      document.getElementById("sales-trends-section")!,
    ) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(DailyAnalytics).not.toHaveBeenCalled();
});
it("puts a bounded recent-activity preview after the graphs and expands it without another request", async () => {
  const orders = Array.from({ length: 6 }, (_, index) =>
    recentOrder({
      id: `order-${index}`,
      orderNumber: `ORD-00000${6 - index}`,
    }),
  );
  vi.mocked(getDailySales).mockImplementation(async (shopId, businessDate) => ({
    shopId,
    businessDate,
    ...salesBusinessDayBounds(businessDate)!,
    timezone: "Asia/Manila",
    currency: "PHP",
    totalSales: "1.20",
    completedOrders: 6,
    itemsSold: 6,
    paymentBreakdown: breakdown("1.20", 6),
    recentOrders: orders,
  }));
  setup();
  await screen.findByRole("region", { name: "Business overview" });
  const activity = screen.getByRole("region", { name: "Recent Orders" });
  const list = within(activity).getByRole("list", {
    name: "Recent completed orders, newest first",
  });
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  expect(list).toHaveTextContent("ORD-000006");
  expect(list).not.toHaveTextContent("ORD-000003");
  expect(
    document
      .getElementById("sales-trends-section")!
      .compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  const requests = vi.mocked(getDailySales).mock.calls.length;
  const expand = within(activity).getByRole("button", {
    name: "Show all 6 recent orders",
  });
  expect(expand).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expand);
  expect(within(list).getAllByRole("listitem")).toHaveLength(6);
  expect(activity).toHaveTextContent("6 of 6 recent orders shown");
  expect(getDailySales).toHaveBeenCalledTimes(requests);
  fireEvent.click(
    within(activity).getByRole("button", { name: "Show fewer recent orders" }),
  );
  expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(
    within(activity).getByRole("button", { name: "Show all 6 recent orders" }),
  );
  fireEvent.change(screen.getByLabelText("Business date"), {
    target: { value: "2026-10-15" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Show all 6 recent orders" }),
    ).toHaveAttribute("aria-expanded", "false"),
  );
});
it("starts with the overview and loads shared-period history only when opened", async () => {
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  expect(DailyAnalytics).not.toHaveBeenCalled();
  await openHistory();
  expect(document.getElementById("sales-history-section")).toHaveAttribute(
    "open",
  );
  expect(DailyAnalytics).toHaveBeenCalled();
  expect(vi.mocked(DailyAnalytics).mock.calls.at(-1)?.[0]).toMatchObject({
    startDate: "2026-10-16",
    endDate: "2026-10-16",
    rangeMode: "single-day",
    enabled: true,
  });
});
it("uses the one central picker for history, single-day cards and applied custom dates", async () => {
  vi.mocked(getCustomSales).mockResolvedValue(customReport());
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  await openHistory();
  fireEvent.change(screen.getByLabelText("Business date"), {
    target: { value: "2026-10-14" },
  });
  await waitFor(() =>
    expect(vi.mocked(DailyAnalytics).mock.calls.at(-1)?.[0]).toMatchObject({
      startDate: "2026-10-14",
      endDate: "2026-10-14",
      enabled: true,
    }),
  );
  expect(vi.mocked(SalesTrends).mock.calls.at(-1)?.[0]).toMatchObject({
    startDate: "2026-10-14",
    endDate: "2026-10-14",
  });
  chooseCustom();
  expect(vi.mocked(DailyAnalytics).mock.calls.at(-1)?.[0]).toMatchObject({
    enabled: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await screen.findByText("₱12.35", { selector: ".sales-amount" });
  expect(vi.mocked(DailyAnalytics).mock.calls.at(-1)?.[0]).toMatchObject({
    startDate: "2026-10-15",
    endDate: "2026-10-17",
    rangeMode: "custom",
    enabled: true,
  });
  expect(screen.getByText("Daily, weekly & monthly history")).toBeVisible();
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-13" },
  });
  expect(vi.mocked(DailyAnalytics).mock.calls.at(-1)?.[0]).toMatchObject({
    startDate: "2026-10-15",
    endDate: "2026-10-17",
    enabled: true,
  });
});
it.each(["daily", "weekly", "monthly"])(
  "Refresh sales updates active %s history without refreshing another shop",
  async (period) => {
    const view = setup();
    await screen.findByText("₱0.30", { selector: ".sales-amount" });
    const read = vi.fn().mockResolvedValue({ totalSales: "1.00" });
    const foreignRead = vi.fn().mockResolvedValue({ totalSales: "2.00" });
    const observer = new QueryObserver(view.client, {
      queryKey: [
        `${period}-analytics`,
        "user-a",
        "a",
        "2026-10-16",
        "2026-10-16",
      ],
      queryFn: read,
      staleTime: Infinity,
    });
    const foreign = new QueryObserver(view.client, {
      queryKey: [
        `${period}-analytics`,
        "user-a",
        "b",
        "2026-10-16",
        "2026-10-16",
      ],
      queryFn: foreignRead,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => {}),
      unsubscribeForeign = foreign.subscribe(() => {});
    try {
      await waitFor(() =>
        expect(observer.getCurrentResult().isSuccess).toBe(true),
      );
      await waitFor(() =>
        expect(foreign.getCurrentResult().isSuccess).toBe(true),
      );
      fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
      await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
      expect(foreignRead).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      unsubscribeForeign();
    }
  },
);
function chooseCustom(start = "2026-10-15", end = "2026-10-17") {
  fireEvent.click(screen.getByRole("button", { name: "Custom Date" }));
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: start },
  });
  fireEvent.change(screen.getByLabelText("End date"), {
    target: { value: end },
  });
}
it("applies one custom range to cards, payments and recent orders only after Apply", async () => {
  vi.mocked(getCustomSales).mockResolvedValue(customReport());
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  chooseCustom();
  expect(getCustomSales).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("article", { name: "Items Sold" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await screen.findByText("₱12.35", { selector: ".sales-amount" });
  expect(
    screen.getByText("Applied to all metrics: 2026-10-15 – 2026-10-17."),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Number of Orders" })).getByText(
      "2",
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("article", { name: "Items Sold" })).getByText("9"),
  ).toBeVisible();
  expect(
    within(
      screen.getByRole("article", { name: "Average Order Value" }),
    ).getByText("₱6.18"),
  ).toBeVisible();
  fireEvent.click(screen.getByText("View payment details"));
  expect(
    within(screen.getByRole("region", { name: "Payment Breakdown" })).getByRole(
      "row",
      { name: "Cash 2 100.00% ₱12.35 100.00%" },
    ),
  ).toBeVisible();
  expect(
    within(screen.getByRole("region", { name: "Recent Orders" })).getByRole(
      "link",
      { name: "ORD-000042" },
    ),
  ).toBeVisible();
  expect(getCustomSales).toHaveBeenLastCalledWith(
    "a",
    "2026-10-15",
    "2026-10-17",
    expect.any(AbortSignal),
  );
  expect(vi.mocked(TopProducts).mock.calls.at(-1)?.[0]).toMatchObject({
    userId: "user-a",
    shopId: "a",
    startDate: "2026-10-15",
    endDate: "2026-10-17",
  });
  expect(vi.mocked(PeakHours).mock.calls.at(-1)?.[0]).toMatchObject({
    userId: "user-a",
    shopId: "a",
    startDate: "2026-10-15",
    endDate: "2026-10-17",
  });
  expect(vi.mocked(AveragePrepTime).mock.calls.at(-1)?.[0]).toMatchObject({
    userId: "user-a",
    shopId: "a",
    startDate: "2026-10-15",
    endDate: "2026-10-17",
  });
  expect(vi.mocked(SalesTrends).mock.calls.at(-1)?.[0]).toMatchObject({
    userId: "user-a",
    shopId: "a",
    startDate: "2026-10-15",
    endDate: "2026-10-17",
  });
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-14" },
  });
  expect(screen.getByText(/Date edits are not applied yet/)).toBeVisible();
  expect(getCustomSales).toHaveBeenCalledTimes(1);
});
it.each([
  ["2026-10-18", "2026-10-17"],
  ["2025-01-01", "2026-10-17"],
  ["", "2026-10-17"],
])(
  "rejects invalid custom dates %s to %s without fetching",
  async (start, end) => {
    setup();
    await screen.findByText("₱0.30", { selector: ".sales-amount" });
    chooseCustom(start, end);
    expect(
      screen.getByRole("button", { name: "Apply date range" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "valid start/end dates",
    );
    expect(getCustomSales).not.toHaveBeenCalled();
  },
);
it("hides failed summary values on refresh failure and retries the applied range", async () => {
  vi.mocked(getCustomSales)
    .mockResolvedValueOnce(customReport())
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(customReport());
  setup();
  chooseCustom();
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await screen.findByText("₱12.35", { selector: ".sales-amount" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("article", { name: "Items Sold" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Payment Breakdown" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Recent Orders" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("₱12.35", { selector: ".sales-amount" });
  expect(getCustomSales).toHaveBeenLastCalledWith(
    "a",
    "2026-10-15",
    "2026-10-17",
    expect.any(AbortSignal),
  );
});

it("lets independent reports render while the primary summary is still pending", async () => {
  vi.mocked(getDailySales).mockImplementationOnce(() => new Promise(() => {}));
  vi.mocked(TopProducts).mockImplementation(() => (
    <p>Independent top products</p>
  ));
  setup();
  expect(
    screen.getByRole("heading", { name: "Sales dashboard" }),
  ).toBeVisible();
  expect(await screen.findByText("Independent top products")).toBeVisible();
  expect(screen.getByText("Loading sales…")).toBeInTheDocument();
  expect(screen.getByText("Loading payment breakdown…")).toBeInTheDocument();
  expect(screen.getByText("Loading recent orders…")).toBeInTheDocument();
});

it("keeps independent reports available when the summary has a network error", async () => {
  vi.mocked(getDailySales).mockRejectedValueOnce(
    new Error("Summary unavailable"),
  );
  vi.mocked(TopProducts).mockImplementation(() => (
    <p>Independent top products</p>
  ));
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh sales",
  );
  expect(await screen.findByText("Independent top products")).toBeVisible();
});
it("cancels the old range and hides old metrics while another range loads", async () => {
  let oldSignal: AbortSignal | undefined;
  let resolve!: (value: ReturnType<typeof customReport>) => void;
  vi.mocked(getCustomSales)
    .mockImplementationOnce((_shop, _start, _end, signal) => {
      oldSignal = signal;
      return new Promise((r) => {
        resolve = r;
      });
    })
    .mockResolvedValue(customReport("2026-10-14", "2026-10-17"));
  setup();
  chooseCustom();
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await waitFor(() => expect(getCustomSales).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-14" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await screen.findByText("₱12.35", { selector: ".sales-amount" });
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => resolve({ ...customReport(), totalSales: "999.00" }));
  expect(screen.queryByText("₱999.00")).not.toBeInTheDocument();
  expect(
    screen.getByText("Applied to all metrics: 2026-10-14 – 2026-10-17."),
  ).toBeVisible();
});
it("resets custom mode on a shop change", async () => {
  vi.mocked(getCustomSales).mockResolvedValue(customReport());
  const view = setup();
  chooseCustom();
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await screen.findByText("₱12.35", { selector: ".sales-amount" });
  view.rerender(view.page("b"));
  expect(screen.getByRole("button", { name: "Single day" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByText(/Applied to all metrics/)).not.toBeInTheDocument();
  expect(getCustomSales).toHaveBeenCalledTimes(1);
});
it("analyzes the applied custom period by sales or order mix without another request", async () => {
  const mixed = {
    ...customReport(),
    totalSales: "100.00",
    completedOrders: 7,
    paymentBreakdown: [
      { paymentMethod: "CASH" as const, orders: 2, totalSales: "30.00" },
      {
        paymentMethod: "GCASH_MANUAL" as const,
        orders: 1,
        totalSales: "60.00",
      },
      { paymentMethod: "CARD_MANUAL" as const, orders: 3, totalSales: "10.00" },
      { paymentMethod: "OTHER" as const, orders: 1, totalSales: "0.00" },
    ],
  };
  vi.mocked(getCustomSales).mockResolvedValue(mixed);
  setup();
  chooseCustom();
  fireEvent.click(screen.getByRole("button", { name: "Apply date range" }));
  await screen.findByText("₱100.00", { selector: ".sales-amount" });
  const region = screen.getByRole("region", { name: "Payment Breakdown" });
  expect(region.querySelector(".sales-payment-order-count")).toHaveTextContent(
    "7 completed orders",
  );
  expect(region.querySelectorAll(".sales-payment-share-track > span")[1]).toHaveStyle({
    width: "60%",
  });
  expect(
    within(region).getByText("Largest sales total: GCash (manual) · ₱60.00."),
  ).toBeVisible();
  fireEvent.click(within(region).getByText("View payment details"));
  expect(
    within(region).getByRole("row", { name: "Other 1 14.28% ₱0.00 0.00%" }),
  ).toBeVisible();
  expect(
    region
      .querySelector("circle.sales-method-1")
      ?.getAttribute("stroke-dasharray")
      ?.split(" ")[0],
  ).toBe("60");
  fireEvent.click(within(region).getByRole("button", { name: "Order share" }));
  expect(region.querySelectorAll(".sales-payment-share-track > span")[2]).toHaveStyle({
    width: "42.86%",
  });
  expect(
    within(region).getByText("Most used: Card (manual) · 3 orders."),
  ).toBeVisible();
  expect(
    region
      .querySelector("circle.sales-method-2")
      ?.getAttribute("stroke-dasharray")
      ?.split(" ")[0],
  ).toBe("42.86");
  expect(
    within(region).getByRole("row", {
      name: "All methods 7 100.00% ₱100.00 100.00%",
    }),
  ).toBeVisible();
  expect(getCustomSales).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-14" },
  });
  expect(screen.getByText(/October 15, 2026.*October 17, 2026/)).toBeVisible();
  expect(getCustomSales).toHaveBeenCalledTimes(1);
});
it("supports order mix when all eligible paid orders have zero sales", async () => {
  vi.mocked(getDailySales).mockResolvedValueOnce({
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    completedOrders: 2,
    totalSales: "0.00",
    itemsSold: 2,
    recentOrders: [],
    paymentBreakdown: SALES_PAYMENT_METHODS.map((paymentMethod) => ({
      paymentMethod,
      orders: paymentMethod === "GCASH_MANUAL" ? 2 : 0,
      totalSales: "0.00",
    })),
  });
  setup();
  const region = await screen.findByRole("region", {
    name: "Payment Breakdown",
  });
  fireEvent.click(within(region).getByText("View payment details"));
  expect(within(region).getByText(/Sales total is ₱0.00/)).toBeVisible();
  expect(
    within(region).getByRole("row", {
      name: "GCash (manual) 2 100.00% ₱0.00 0.00%",
    }),
  ).toBeVisible();
  fireEvent.click(within(region).getByRole("button", { name: "Order share" }));
  expect(
    within(region).getByText("Most used: GCash (manual) · 2 orders."),
  ).toBeVisible();
  expect(
    region
      .querySelector("circle.sales-method-1")
      ?.getAttribute("stroke-dasharray"),
  ).toBe("100 0");
});
it("reports tied leading methods using unrounded values", async () => {
  vi.mocked(getDailySales).mockResolvedValueOnce({
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    completedOrders: 3,
    totalSales: "3.00",
    itemsSold: 3,
    recentOrders: [],
    paymentBreakdown: SALES_PAYMENT_METHODS.map((paymentMethod, i) => ({
      paymentMethod,
      orders: i < 3 ? 1 : 0,
      totalSales: i < 3 ? "1.00" : "0.00",
    })),
  });
  setup();
  const region = await screen.findByRole("region", {
    name: "Payment Breakdown",
  });
  expect(
    within(region).getByText(
      "Largest sales total: Cash, GCash (manual), Card (manual) · ₱1.00 each.",
    ),
  ).toBeVisible();
  fireEvent.click(within(region).getByRole("button", { name: "Order share" }));
  expect(
    within(region).getByText(
      "Most used: Cash, GCash (manual), Card (manual) · 1 order each.",
    ),
  ).toBeVisible();
});
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
    fireEvent.click(screen.getByText("How sales are counted"));
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

it("stops automatic polling after access denial and keeps manual retry available", async () => {
  vi.useFakeTimers();
  vi.mocked(getDailySales).mockRejectedValueOnce(
    new AxiosError("denied", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 403,
    } as never),
  );
  setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25);
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "access to this shop’s sales reports is unavailable",
  );
  expect(screen.getByText("Automatic refresh paused")).toBeVisible();
  const calls = vi.mocked(getDailySales).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45000);
  });
  expect(getDailySales).toHaveBeenCalledTimes(calls);
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Choose another shop" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(25);
  });
  expect(getDailySales).toHaveBeenCalledTimes(calls + 1);
  expect(
    screen.getByText("₱0.30", { selector: ".sales-amount" }),
  ).toBeVisible();
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

it("keeps an explicitly selected historical day when Today rolls over", async () => {
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  fireEvent.change(screen.getByLabelText("Business date"), {
    target: { value: "2026-10-14" },
  });
  await waitFor(() =>
    expect(getDailySales).toHaveBeenLastCalledWith(
      "a",
      "2026-10-14",
      expect.any(AbortSignal),
    ),
  );
  vi.setSystemTime(new Date("2026-10-16T16:00:00.000Z"));
  fireEvent(window, new Event("focus"));
  expect(screen.getByLabelText("Business date")).toHaveValue("2026-10-14");
  expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Today" }));
  await waitFor(() =>
    expect(getDailySales).toHaveBeenLastCalledWith(
      "a",
      "2026-10-17",
      expect.any(AbortSignal),
    ),
  );
});

it("cancels a pending report when switching shops", async () => {
  const signals: AbortSignal[] = [];
  vi.mocked(getDailySales).mockImplementationOnce((_shopId, _date, signal) => {
    signals.push(signal);
    return new Promise(() => {});
  });
  const view = setup();
  await waitFor(() => expect(signals).toHaveLength(1));
  view.rerender(view.page("b"));
  await waitFor(() => expect(signals[0].aborted).toBe(true));
  await waitFor(() =>
    expect(getDailySales).toHaveBeenLastCalledWith(
      "b",
      "2026-10-16",
      expect.any(AbortSignal),
    ),
  );
});

it("clears report cards and the feed when the business date is cleared", async () => {
  setup();
  await screen.findByText("₱0.30", { selector: ".sales-amount" });
  const calls = vi.mocked(getDailySales).mock.calls.length;
  fireEvent.change(screen.getByLabelText("Business date"), {
    target: { value: "" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Choose a valid business date",
  );
  expect(screen.getByRole("button", { name: "Refresh sales" })).toBeDisabled();
  expect(
    screen.queryByRole("region", { name: "Recent Orders" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("₱0.30", { selector: ".sales-amount" }),
  ).not.toBeInTheDocument();
  expect(getDailySales).toHaveBeenCalledTimes(calls);
});

it("validates real report responses and hides previous data if the refreshed feed is incomplete", async () => {
  const actual = await vi.importActual<
    typeof import("../../features/orders/daily-sales")
  >("../../features/orders/daily-sales");
  vi.mocked(getDailySales).mockImplementation(actual.getDailySales);
  const data = {
    shopId: "a",
    businessDate: "2026-10-16",
    ...salesBusinessDayBounds("2026-10-16")!,
    timezone: "Asia/Manila",
    currency: "PHP",
    totalSales: "0.30",
    completedOrders: 1,
    itemsSold: 7,
    paymentBreakdown: breakdown("0.30", 1),
    recentOrders: [recentOrder({ totalPrice: "0.30" })],
  };
  const get = vi
    .spyOn(api, "get")
    .mockResolvedValueOnce({ data })
    .mockResolvedValueOnce({ data: { ...data, recentOrders: [] } });
  try {
    setup();
    expect(
      await screen.findByRole("link", { name: "ORD-000042" }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Refresh sales" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "couldn’t refresh",
    );
    expect(
      screen.queryByRole("region", { name: "Recent Orders" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Average Order Value" }),
    ).not.toBeInTheDocument();
  } finally {
    get.mockRestore();
  }
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
  fireEvent.click(within(region).getByText("View payment details"));
  const table = within(region).getByRole("table", {
    name: "Sales and order counts by payment method",
  });
  for (const [label, count, orderShare, amount, salesShare] of [
    ["Cash", "2", "28.57%", "₱100.00", "16.67%"],
    ["GCash (manual)", "1", "14.29%", "₱200.00", "33.33%"],
    ["Card (manual)", "3", "42.86%", "₱300.00", "50.00%"],
    ["Other", "1", "14.28%", "₱0.00", "0.00%"],
  ]) {
    const row = within(table).getByRole("row", {
      name: `${label} ${count} ${orderShare} ${amount} ${salesShare}`,
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

async function openHistory() {
  fireEvent.click(screen.getByText("Daily, weekly & monthly history"));
  await waitFor(() => expect(DailyAnalytics).toHaveBeenCalled());
}
