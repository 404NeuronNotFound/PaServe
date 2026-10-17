import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { salesTrendRanges, type SalesTrendsResponse } from "@paserve/contracts";
import { getSalesTrends } from "../../features/orders/sales-trends";
import { SalesTrends } from "./SalesTrends";
vi.mock("../../features/orders/sales-trends", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/orders/sales-trends")
  >()),
  getSalesTrends: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function fixture(
  currentSales = "150.00",
  previousSales = "100.00",
  currentOrders = 3,
  previousOrders = 2,
): SalesTrendsResponse {
  const ranges = salesTrendRanges("2026-10-15", "2026-10-16")!;
  const period = (
    range: typeof ranges.current,
    totalSales: string,
    completedOrders: number,
  ) => ({
    startDate: range.dates[0],
    endDate: range.dates.at(-1)!,
    from: range.from,
    to: range.to,
    currency: "PHP" as const,
    totalSales,
    completedOrders,
    days: range.dates.map((businessDate, i) => ({
      businessDate,
      totalSales: i === 0 ? totalSales : "0.00",
      completedOrders: i === 0 ? completedOrders : 0,
    })),
  });
  return {
    shopId: "shop",
    timezone: "Asia/Manila",
    currency: "PHP",
    comparisonBasis: "PREVIOUS_EQUAL_PERIOD",
    current: period(ranges.current, currentSales, currentOrders),
    previous: period(ranges.previous, previousSales, previousOrders),
  };
}
function setup(startDate = "2026-10-15", endDate = "2026-10-16") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <SalesTrends
        userId="user"
        shopId="shop"
        startDate={startDate}
        endDate={endDate}
      />
    </QueryClientProvider>,
  );
}
it("shows exact sales/order comparisons, preceding dates, and zero-filled daily bars", async () => {
  vi.mocked(getSalesTrends).mockResolvedValue(fixture());
  setup();
  const table = await screen.findByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(screen.getByText(/Previous: 2026-10-13/)).toBeVisible();
  expect(screen.getByText(/Increase:.*50.00.*50.00%/)).toBeVisible();
  expect(screen.getByText("Increase: +1 · +50.00%")).toBeVisible();
  expect(within(table).getByText("2026-10-14")).toBeVisible();
  expect(getSalesTrends).toHaveBeenCalledWith(
    "shop",
    "2026-10-15",
    "2026-10-16",
    expect.any(AbortSignal),
  );
});
it("does not invent a percentage from a zero baseline", async () => {
  vi.mocked(getSalesTrends).mockResolvedValue(fixture("150.00", "0.00", 3, 0));
  setup();
  expect(await screen.findByText(/No prior sales baseline/)).toBeVisible();
  expect(screen.getByText(/No prior order baseline/)).toBeVisible();
});
it("shows an empty comparison with no change", async () => {
  vi.mocked(getSalesTrends).mockResolvedValue(fixture("0.00", "0.00", 0, 0));
  setup();
  expect(
    await screen.findByText("No completed sales in either period."),
  ).toBeVisible();
  expect(screen.getByText("No change: 0 · 0.00%")).toBeVisible();
});
it("warns that present/future periods use full calendar comparisons", async () => {
  vi.mocked(getSalesTrends).mockResolvedValue(fixture());
  setup("2090-01-01", "2090-01-02");
  expect(await screen.findByText(/not matching elapsed time/)).toBeVisible();
});
it("hides stale data on refresh failure and supports retry", async () => {
  vi.mocked(getSalesTrends)
    .mockResolvedValueOnce(fixture())
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(fixture());
  setup();
  expect(await screen.findByRole("table")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales trends" }));
  expect(
    await screen.findByText(/couldn’t refresh sales trends/),
  ).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh sales trends" }));
  expect(await screen.findByRole("table")).toBeVisible();
});
it("does not request an unrepresentable preceding period", () => {
  setup("0001-01-01", "0001-01-01");
  expect(
    screen.getByText(/no supported preceding comparison period/),
  ).toBeVisible();
  expect(getSalesTrends).not.toHaveBeenCalled();
});
