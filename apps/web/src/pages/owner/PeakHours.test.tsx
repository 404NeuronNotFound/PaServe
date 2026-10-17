import { afterEach, expect, it, vi } from "vitest";
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
import type { PeakHoursResponse } from "@paserve/contracts";
import { getPeakHours } from "../../features/orders/peak-hours";
import { PeakHours } from "./PeakHours";
vi.mock("../../features/orders/peak-hours", () => ({ getPeakHours: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});
const data: PeakHoursResponse = {
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: "2026-10-14T16:00:00.000Z",
  to: "2026-10-17T16:00:00.000Z",
  timezone: "Asia/Manila",
  timeBasis: "COMPLETED_AT",
  currency: "PHP",
  completedOrders: 4,
  totalSales: "0.30",
  peakHours: [0, 23],
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    completedOrders: hour === 0 || hour === 23 ? 2 : 0,
    totalSales: hour === 0 ? "0.10" : hour === 23 ? "0.20" : "0.00",
  })),
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <PeakHours
        userId="user"
        shopId="shop"
        startDate="2026-10-15"
        endDate="2026-10-17"
      />
    </QueryClientProvider>,
  );
}
it("shows every tied busiest hour and all 24 exact hourly rows", async () => {
  vi.mocked(getPeakHours).mockResolvedValue(data);
  setup();
  expect(
    await screen.findByText(
      "Busiest hours: 00:00–01:00, 23:00–24:00 · 2 orders each",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Hourly completion activity chart" }),
  ).toBeVisible();
  fireEvent.click(screen.getByText("View all 24 hourly totals"));
  const table = screen.getByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(26);
  expect(
    within(table).getByRole("row", { name: "00:00–01:00 (busiest) 2 ₱0.10" }),
  ).toBeVisible();
  expect(
    within(table).getByRole("row", { name: "01:00–02:00 0 ₱0.00" }),
  ).toBeVisible();
  expect(getPeakHours).toHaveBeenCalledWith(
    "shop",
    "2026-10-15",
    "2026-10-17",
    expect.any(AbortSignal),
  );
});
it("does not invent peaks for zero-order periods", async () => {
  vi.mocked(getPeakHours).mockResolvedValue({
    ...data,
    completedOrders: 0,
    totalSales: "0.00",
    peakHours: [],
    hours: data.hours.map((hour) => ({
      ...hour,
      completedOrders: 0,
      totalSales: "0.00",
    })),
  });
  setup();
  expect(
    await screen.findByText(
      "No eligible completed orders in this period. No busiest hour yet.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/Busiest hours:/)).not.toBeInTheDocument();
});
it("hides the old chart on errors and supports manual retry", async () => {
  vi.mocked(getPeakHours)
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(data);
  setup();
  await screen.findByRole("region", {
    name: "Hourly completion activity chart",
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh peak hours" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh peak hours",
  );
  expect(
    screen.queryByRole("region", { name: "Hourly completion activity chart" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh peak hours" }));
  expect(
    await screen.findByRole("region", {
      name: "Hourly completion activity chart",
    }),
  ).toBeVisible();
});
it("pauses polling after access denial while keeping manual retry available", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.mocked(getPeakHours)
    .mockRejectedValueOnce(
      new AxiosError("denied", "ERR_BAD_REQUEST", undefined, undefined, {
        status: 403,
      } as never),
    )
    .mockResolvedValue(data);
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Automatic refresh is paused",
  );
  await act(async () => {
    vi.advanceTimersByTime(16000);
  });
  expect(getPeakHours).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh peak hours" }));
  await waitFor(() => expect(getPeakHours).toHaveBeenCalledTimes(2));
  expect(
    await screen.findByRole("region", {
      name: "Hourly completion activity chart",
    }),
  ).toBeVisible();
});
