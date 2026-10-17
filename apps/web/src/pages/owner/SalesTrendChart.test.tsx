import { afterEach, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { salesTrendRanges, type SalesTrendPeriod } from "@paserve/contracts";
import { SalesTrendChart } from "./SalesTrendChart";
afterEach(cleanup);
function periods(single = false, empty = false) {
  const ranges = salesTrendRanges(
    "2026-10-15",
    single ? "2026-10-15" : "2026-10-16",
  )!;
  const period = (
    range: typeof ranges.current,
    previous = false,
  ): SalesTrendPeriod => ({
    startDate: range.dates[0],
    endDate: range.dates.at(-1)!,
    from: range.from,
    to: range.to,
    currency: "PHP",
    completedOrders: empty ? 0 : 1,
    totalSales: empty ? "0.00" : previous ? "10.01" : "90071992547409.93",
    days: range.dates.map((businessDate, i) => ({
      businessDate,
      completedOrders: !empty && i === 0 ? 1 : 0,
      totalSales:
        empty || i !== 0 ? "0.00" : previous ? "10.01" : "90071992547409.93",
    })),
  });
  return {
    current: period(ranges.current),
    previous: period(ranges.previous, true),
  };
}
it("lets keyboard controls inspect paired days with exact large monetary values", () => {
  render(<SalesTrendChart {...periods()} />);
  const slider = screen.getByRole("slider", { name: "Inspect comparison day" });
  expect(slider).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("2026-10-16: ₱0.00"),
  );
  fireEvent.change(slider, { target: { value: "0" } });
  expect(slider).toHaveAttribute(
    "aria-valuetext",
    "2026-10-15: ₱90,071,992,547,409.93; previous 2026-10-13: ₱10.01",
  );
  expect(screen.getByText("₱10.01")).toBeVisible();
});
it("shows a single-day comparison as two labelled amounts rather than a fictitious time series", () => {
  render(<SalesTrendChart {...periods(true)} />);
  const figure = screen.getByRole("figure", {
    name: "Gross sales comparison chart",
  });
  expect(within(figure).getByText("₱90,071,992,547,409.93")).toBeVisible();
  expect(within(figure).getByText("₱10.01")).toBeVisible();
  expect(screen.queryByRole("slider")).not.toBeInTheDocument();
});
it("keeps a zero-sales series finite and exposes zero rather than invented movement", () => {
  const { container } = render(<SalesTrendChart {...periods(false, true)} />);
  expect(screen.getByRole("slider")).toHaveAttribute(
    "aria-valuetext",
    expect.stringContaining("₱0.00"),
  );
  expect(
    container.querySelector(".sales-chart-current")?.getAttribute("d"),
  ).not.toMatch(/NaN|Infinity/);
});
