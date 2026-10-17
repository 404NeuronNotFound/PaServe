import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AveragePrepTimeResponse } from "@paserve/contracts";
import { getAveragePrepTime } from "../../features/orders/average-prep-time";
import { AveragePrepTime } from "./AveragePrepTime";
vi.mock("../../features/orders/average-prep-time", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../features/orders/average-prep-time")
  >()),
  getAveragePrepTime: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const data: AveragePrepTimeResponse = {
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: "2026-10-14T16:00:00.000Z",
  to: "2026-10-17T16:00:00.000Z",
  timezone: "Asia/Manila",
  durationBasis: "PREPARING_TO_READY",
  selectionBasis: "COMPLETED_AT",
  eligibleOrders: 5,
  measuredOrders: 2,
  excludedOrders: 3,
  missingTimestamps: 2,
  invalidTimestamps: 1,
  totalDurationMs: "90001",
  averageDurationMs: 45001,
};
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AveragePrepTime
        userId="user"
        shopId="shop"
        startDate="2026-10-15"
        endDate="2026-10-17"
      />
    </QueryClientProvider>,
  );
}
it("shows the defined pair, measured average, sample coverage and exclusions", async () => {
  vi.mocked(getAveragePrepTime).mockResolvedValue(data);
  setup();
  expect(await screen.findByText("45.001s")).toBeVisible();
  expect(screen.getByText("Average from 2 measured orders")).toBeVisible();
  expect(screen.getByText("Eligible orders").parentElement).toHaveTextContent(
    "5",
  );
  expect(screen.getByText("Measured orders").parentElement).toHaveTextContent(
    "2",
  );
  expect(screen.getByText("Excluded orders").parentElement).toHaveTextContent(
    "3",
  );
  expect(
    screen.getByText(
      "Excluded: 2 with missing timestamps; 1 with invalid timestamp order.",
    ),
  ).toBeVisible();
  expect(getAveragePrepTime).toHaveBeenCalledWith(
    "shop",
    "2026-10-15",
    "2026-10-17",
    expect.any(AbortSignal),
  );
});
it.each([0, 3])(
  "shows no data for %i eligible orders without valid samples",
  async (eligible) => {
    vi.mocked(getAveragePrepTime).mockResolvedValue({
      ...data,
      eligibleOrders: eligible,
      measuredOrders: 0,
      excludedOrders: eligible,
      missingTimestamps: eligible,
      invalidTimestamps: 0,
      averageDurationMs: null,
      totalDurationMs: "0",
    });
    setup();
    expect(await screen.findByText(/No preparation data/)).toBeVisible();
    expect(screen.queryByText("0s")).not.toBeInTheDocument();
  },
);
it("distinguishes a valid zero-duration sample from no data", async () => {
  vi.mocked(getAveragePrepTime).mockResolvedValue({
    ...data,
    eligibleOrders: 1,
    measuredOrders: 1,
    excludedOrders: 0,
    missingTimestamps: 0,
    invalidTimestamps: 0,
    averageDurationMs: 0,
    totalDurationMs: "0",
  });
  setup();
  expect(await screen.findByText("0s")).toBeVisible();
  expect(screen.queryByText(/No preparation data/)).not.toBeInTheDocument();
});
it("hides the previous average on failure and supports retry", async () => {
  vi.mocked(getAveragePrepTime)
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(data);
  setup();
  await screen.findByText("45.001s");
  fireEvent.click(screen.getByRole("button", { name: "Refresh prep time" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh average preparation time",
  );
  expect(screen.queryByText("45.001s")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh prep time" }));
  expect(await screen.findByText("45.001s")).toBeVisible();
});
