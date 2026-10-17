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
import { DailyAnalytics } from "./DailyAnalytics";

vi.mock("../../features/orders/daily-analytics", () => ({
  getDailyAnalytics: vi.fn(),
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
