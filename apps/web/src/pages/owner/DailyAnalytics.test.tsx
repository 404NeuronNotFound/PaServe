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
import { getDailyAnalytics } from "../../features/orders/daily-analytics";
import { getWeeklyAnalytics } from "../../features/orders/weekly-analytics";
import { salesWeeklyRange } from "@paserve/contracts";
import { DailyAnalytics } from "./DailyAnalytics";

vi.mock("../../features/orders/daily-analytics", () => ({
  getDailyAnalytics: vi.fn(),
}));
vi.mock("../../features/orders/weekly-analytics", () => ({
  getWeeklyAnalytics: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const data = {
  shopId: "shop",
  startDate: "2026-10-16",
  endDate: "2026-10-16",
  timezone: "Asia/Manila" as const,
  from: "2026-10-15T16:00:00.000Z",
  to: "2026-10-16T16:00:00.000Z",
  currency: "PHP" as const,
  totalSales: "10.01",
  completedOrders: 3,
  itemsSold: 7,
  days: [
    {
      businessDate: "2026-10-16",
      totalSales: "10.01",
      completedOrders: 3,
      itemsSold: 7,
    },
  ],
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DailyAnalytics userId="user" shopId="shop" today="2026-10-16" />
    </QueryClientProvider>,
  );
}
it("shows daily rows and weighted range average, then changes the range", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(data);
  setup();
  const table = await screen.findByRole("table");
  expect(within(table).getAllByText("₱3.34")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-15" },
  });
  await waitFor(() =>
    expect(getDailyAnalytics).toHaveBeenLastCalledWith(
      "shop",
      "2026-10-15",
      "2026-10-16",
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use today" }));
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-16");
});
it("hides results and avoids requests for reversed or overlong ranges", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(data);
  setup();
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-17" },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("at most 366 days");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(getDailyAnalytics).toHaveBeenCalledTimes(1);
});
it("hides previous results on refresh failure and supports retry", async () => {
  vi.mocked(getDailyAnalytics)
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(data);
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
it("shows zero days in an empty period", async () => {
  const day = {
    businessDate: "2026-10-16",
    totalSales: "0.00",
    completedOrders: 0,
    itemsSold: 0,
  };
  vi.mocked(getDailyAnalytics).mockResolvedValue({
    ...data,
    ...day,
    days: [day],
  });
  setup();
  expect(
    await screen.findByText(/No completed sales in this range/),
  ).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent(
    "2026-10-16 (in progress)",
  );
});
const weeklyData = () => ({
  ...data,
  startDate: "2026-10-12",
  endDate: "2026-10-18",
  from: "2026-10-11T16:00:00.000Z",
  to: "2026-10-18T16:00:00.000Z",
  weekStartsOn: "MONDAY" as const,
  weeks: [
    {
      ...salesWeeklyRange("2026-10-12", "2026-10-18")!.weeks[0],
      totalSales: "10.01",
      completedOrders: 3,
      itemsSold: 7,
    },
  ],
});
it("switches to Weekly, defaults to this Monday-Sunday, and preserves explicit dates", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(data);
  vi.mocked(getWeeklyAnalytics).mockResolvedValue(weeklyData());
  setup();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
  expect(
    await screen.findByRole("region", { name: "Weekly performance table" }),
  ).toHaveTextContent("2026-10-12 – 2026-10-18 (in progress)");
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-12");
  expect(screen.getByLabelText("End date")).toHaveValue("2026-10-18");
  expect(getWeeklyAnalytics).toHaveBeenLastCalledWith(
    "shop",
    "2026-10-12",
    "2026-10-18",
    expect.any(AbortSignal),
  );
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-14" },
  });
  await waitFor(() =>
    expect(getWeeklyAnalytics).toHaveBeenLastCalledWith(
      "shop",
      "2026-10-14",
      "2026-10-18",
      expect.any(AbortSignal),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Daily" }));
  expect(screen.getByLabelText("Start date")).toHaveValue("2026-10-14");
});
it("labels clipped weeks and hides weekly totals on refresh failure", async () => {
  vi.mocked(getDailyAnalytics).mockResolvedValue(data);
  const partial = {
    ...weeklyData(),
    startDate: "2026-10-16",
    endDate: "2026-10-16",
    weeks: [
      {
        ...weeklyData().weeks[0],
        fromDate: "2026-10-16",
        toDate: "2026-10-16",
        partial: true,
      },
    ],
  };
  vi.mocked(getWeeklyAnalytics).mockResolvedValue(partial);
  setup();
  await screen.findByRole("table");
  fireEvent.change(screen.getByLabelText("Start date"), {
    target: { value: "2026-10-16" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Weekly" }));
  expect(await screen.findByRole("table")).toHaveTextContent(
    "partial: 2026-10-16 – 2026-10-16",
  );
  vi.mocked(getWeeklyAnalytics).mockRejectedValueOnce(new Error("Offline"));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh weekly analytics" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh weekly analytics",
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
