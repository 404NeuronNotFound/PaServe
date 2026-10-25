import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  salesDailyRange,
  salesWeeklyRange,
  salesMonthlyRange,
} from "@paserve/contracts";
import { getDailyAnalytics } from "../../features/orders/daily-analytics";
import { getWeeklyAnalytics } from "../../features/orders/weekly-analytics";
import { getMonthlyAnalytics } from "../../features/orders/monthly-analytics";
import { DailyAnalytics } from "./DailyAnalytics";
vi.mock("../../features/orders/daily-analytics", () => ({
  getDailyAnalytics: vi.fn(),
}));
vi.mock("../../features/orders/weekly-analytics", () => ({
  getWeeklyAnalytics: vi.fn(),
}));
vi.mock("../../features/orders/monthly-analytics", () => ({
  getMonthlyAnalytics: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const summary = { totalSales: "10.01", completedOrders: 3, itemsSold: 7 };
const zero = { totalSales: "0.00", completedOrders: 0, itemsSold: 0 };
function fixtures(startDate = "2026-10-16", endDate = "2026-10-16") {
  const range = salesDailyRange(startDate, endDate)!;
  const base = {
    shopId: "shop",
    startDate,
    endDate,
    from: range.from,
    to: range.to,
    timezone: "Asia/Manila" as const,
    currency: "PHP" as const,
    ...summary,
  };
  return {
    daily: {
      ...base,
      days: range.dates.map((businessDate, i) => ({
        businessDate,
        ...(i === 0 ? summary : zero),
      })),
    },
    weekly: {
      ...base,
      weekStartsOn: "MONDAY" as const,
      weeks: salesWeeklyRange(startDate, endDate)!.weeks.map((period, i) => ({
        ...period,
        ...(i === 0 ? summary : zero),
      })),
    },
    monthly: {
      ...base,
      aggregation: "CALENDAR_MONTH" as const,
      months: salesMonthlyRange(startDate, endDate)!.months.map(
        (period, i) => ({ ...period, ...(i === 0 ? summary : zero) }),
      ),
    },
  };
}
function setup(
  startDate = "2026-10-16",
  endDate = "2026-10-16",
  enabled = true,
  rangeMode?: "single-day" | "custom",
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (start = startDate, end = endDate, active = enabled) => (
    <QueryClientProvider client={client}>
      <DailyAnalytics
        userId="user"
        shopId="shop"
        today="2026-10-16"
        startDate={start}
        endDate={end}
        rangeMode={rangeMode}
        enabled={active}
      />
    </QueryClientProvider>
  );
  return { ...render(view()), view };
}
it("pages a long history without changing range totals and resets for a new range", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures("2026-10-01", "2026-10-31").daily);
  const { rerender, view } = setup("2026-10-01", "2026-10-31");
  const table = await screen.findByRole("table");
  const pager = within(screen.getByRole("navigation", { name: "Sales history pagination" }));
  expect(within(table).getAllByRole("row")).toHaveLength(27);
  expect(table).toHaveTextContent("2026-10-01");
  expect(table).not.toHaveTextContent("2026-10-31");
  const total = within(table).getByRole("row", { name: /Range total/ }).textContent;
  fireEvent.click(pager.getByRole("button", { name: "Next" }));
  expect(table).toHaveTextContent("2026-10-31");
  expect(table).not.toHaveTextContent("2026-10-01");
  expect(within(table).getByRole("row", { name: /Range total/ }).textContent).toBe(total);
  expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();
  vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures("2026-10-01", "2026-10-02").daily);
  rerender(view("2026-10-01", "2026-10-02"));
  await waitFor(() => expect(screen.getByRole("table")).toHaveTextContent("2026-10-02"));
  expect(screen.queryByRole("navigation", { name: "Sales history pagination" })).not.toBeInTheDocument();
});
it("uses supplied dates and weighted average without adding another date picker", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures().daily);
  const { container } = setup();
  const table = await screen.findByRole("table");
  expect(within(table).getAllByText("₱3.34")).toHaveLength(2);
  expect(getDailyAnalytics).toHaveBeenCalledWith(
    "shop",
    "2026-10-16",
    "2026-10-16",
    expect.any(AbortSignal),
  );
  expect(container.querySelector('input[type="date"]')).toBeNull();
  expect(screen.getByText(/Selected day ·/)).toBeVisible();
});
it.each([
  ["Weekly", "2026-10-10", 7],
  ["Monthly", "2026-09-17", 30],
] as const)(
  "loads %s history for its full trailing range",
  async (period, startDate, days) => {
    vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures().daily);
    vi.mocked(getWeeklyAnalytics).mockResolvedValue(fixtures(startDate, "2026-10-16").weekly);
    vi.mocked(getMonthlyAnalytics).mockResolvedValue(fixtures(startDate, "2026-10-16").monthly);
    setup();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: period }));
    const table = await screen.findByRole("region", {
      name: `${period} performance table`,
    });
    expect(screen.getByText(new RegExp(`Last ${days} days ·`))).toBeVisible();
    expect(within(table).getByRole("row", { name: /Range total/ })).toHaveTextContent("₱10.01");
    expect(
      period === "Weekly" ? getWeeklyAnalytics : getMonthlyAnalytics,
    ).toHaveBeenCalledWith(
      "shop",
      startDate,
      "2026-10-16",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: "Daily" }));
    await screen.findByRole("region", { name: "Daily performance table" });
    expect(screen.getByRole("table")).not.toHaveTextContent("partial:");
  },
);
it.each([
  ["2026-10-25", "2026-09-26"],
  ["2026-01-10", "2025-12-12"],
  ["2024-03-01", "2024-02-01"],
])("includes thirty business days ending %s, across calendar boundaries", async (endDate, startDate) => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures(endDate, endDate).daily);
  vi.mocked(getMonthlyAnalytics).mockResolvedValue(fixtures(startDate, endDate).monthly);
  setup(endDate, endDate);
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
  const table = await screen.findByRole("region", { name: "Monthly performance table" });
  expect(getMonthlyAnalytics).toHaveBeenCalledWith("shop", startDate, endDate, expect.any(AbortSignal));
  expect(table).toHaveTextContent("Range total");
});
it.each(["Weekly", "Monthly"] as const)("keeps an explicitly applied one-day custom range in %s", async (period) => {
  const data = fixtures();
  vi.mocked(getDailyAnalytics).mockResolvedValue(data.daily);
  vi.mocked(getWeeklyAnalytics).mockResolvedValue(data.weekly);
  vi.mocked(getMonthlyAnalytics).mockResolvedValue(data.monthly);
  setup("2026-10-16", "2026-10-16", true, "custom");
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: period }));
  await screen.findByRole("region", { name: `${period} performance table` });
  expect(period === "Weekly" ? getWeeklyAnalytics : getMonthlyAnalytics).toHaveBeenCalledWith("shop", "2026-10-16", "2026-10-16", expect.any(AbortSignal));
  expect(screen.getByText(/Custom range ·/)).toBeVisible();
});
it.each(["Weekly", "Monthly"] as const)(
  "preserves %s grouping when the parent applies a different range",
  async (period) => {
    vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures().daily);
    vi.mocked(getWeeklyAnalytics).mockResolvedValue(fixtures().weekly);
    vi.mocked(getMonthlyAnalytics).mockResolvedValue(fixtures().monthly);
    const { rerender, view } = setup();
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: period }));
    await screen.findByRole("region", { name: `${period} performance table` });
    vi.mocked(getWeeklyAnalytics).mockResolvedValue(
      fixtures("2026-10-15", "2026-10-17").weekly,
    );
    vi.mocked(getMonthlyAnalytics).mockResolvedValue(
      fixtures("2026-10-15", "2026-10-17").monthly,
    );
    rerender(view("2026-10-15", "2026-10-17"));
    await waitFor(() =>
      expect(
        period === "Weekly" ? getWeeklyAnalytics : getMonthlyAnalytics,
      ).toHaveBeenLastCalledWith(
        "shop",
        "2026-10-15",
        "2026-10-17",
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByRole("button", { name: period })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  },
);
it("does not request or reveal history while the main selected report is unavailable", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(fixtures().daily);
  const { rerender, view } = setup("2026-10-16", "2026-10-16", false);
  expect(getDailyAnalytics).not.toHaveBeenCalled();
  expect(
    screen.getByRole("button", { name: "Refresh daily analytics" }),
  ).toBeDisabled();
  rerender(view("2026-10-16", "2026-10-16", true));
  await screen.findByRole("table");
  rerender(view("2026-10-16", "2026-10-16", false));
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("cancels the old history request when the central dates change", async () => {
  let oldSignal: AbortSignal | undefined;
  vi.mocked(getDailyAnalytics)
    .mockImplementationOnce((_shop, _start, _end, signal) => {
      oldSignal = signal;
      return new Promise(() => {});
    })
    .mockResolvedValue(fixtures("2026-10-15", "2026-10-17").daily);
  const { rerender, view } = setup();
  await waitFor(() => expect(getDailyAnalytics).toHaveBeenCalledTimes(1));
  rerender(view("2026-10-15", "2026-10-17"));
  expect(await screen.findByRole("table")).toHaveTextContent("2026-10-15");
  expect(oldSignal?.aborted).toBe(true);
});
it("rejects invalid supplied ranges without requesting", () => {
  setup("2026-10-17", "2026-10-16");
  expect(screen.getByRole("alert")).toHaveTextContent("at most 366 days");
  expect(getDailyAnalytics).not.toHaveBeenCalled();
});
it("hides history on refresh failure and allows retry for the same shared dates", async () => {
  vi.mocked(getDailyAnalytics)
    .mockResolvedValueOnce(fixtures().daily)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(fixtures().daily);
  setup();
  await screen.findByRole("table");
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh daily analytics" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh",
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh daily analytics" }),
  );
  expect(await screen.findByRole("table")).toBeVisible();
});
it("retains zero days and truthful no-data state", async () => {
  const empty = { ...fixtures().daily, ...zero };
  empty.days = empty.days.map((day) => ({ ...day, ...zero }));
  vi.mocked(getDailyAnalytics).mockResolvedValue(empty);
  setup();
  expect(
    await screen.findByText(/No completed sales in this range/),
  ).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent("2026-10-16");
  expect(screen.getByRole("table")).toHaveTextContent("In progress");
});
