import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import { getDailySales } from "./daily-sales";

const response = () => ({
  shopId: "shop-a",
  businessDate: "2026-10-16",
  timezone: "Asia/Manila",
  from: "2026-10-15T16:00:00.000Z",
  to: "2026-10-16T16:00:00.000Z",
  currency: "PHP",
  completedOrders: 30,
  totalSales: "12345678901234.30",
});
afterEach(() => vi.restoreAllMocks());
it("requests the explicit business date and preserves large exact sales totals", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: response() });
  const signal = new AbortController().signal;
  expect(await getDailySales("shop-a", "2026-10-16", signal)).toEqual(
    response(),
  );
  expect(get).toHaveBeenCalledWith(
    "/shops/shop-a/reports/daily-sales",
    expect.objectContaining({ params: { date: "2026-10-16" }, signal }),
  );
});
it.each([
  { shopId: "shop-b" },
  { businessDate: "2026-10-15" },
  { timezone: "UTC" },
  { from: "2026-10-16T00:00:00.000Z" },
  { totalSales: 123 },
  { totalSales: "1.234" },
  { completedOrders: -1 },
  { completedOrders: 0 },
])("rejects a mismatched or malformed report: %j", async (change) => {
  vi.spyOn(api, "get").mockResolvedValue({
    data: { ...response(), ...change },
  });
  await expect(
    getDailySales("shop-a", "2026-10-16", new AbortController().signal),
  ).rejects.toThrow("could not be verified");
});
