import { afterEach, expect, it, vi } from "vitest";
import { salesDailyRange, type TopProductsResponse } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { getTopProducts } from "./top-products";
const fixture = (): TopProductsResponse => ({
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: salesDailyRange("2026-10-15", "2026-10-17")!.from,
  to: salesDailyRange("2026-10-15", "2026-10-17")!.to,
  timezone: "Asia/Manila",
  currency: "PHP",
  metric: "QUANTITY",
  limit: 10,
  productCount: 2,
  totalQuantity: 7,
  totalRevenue: "11.00",
  otherQuantity: 0,
  otherRevenue: "0.00",
  products: [
    {
      productSnapshotId: "saved-a",
      productName: "Coffee",
      quantity: 5,
      revenue: "1.00",
    },
    {
      productSnapshotId: "saved-b",
      productName: "Coffee",
      quantity: 2,
      revenue: "10.00",
    },
  ],
});
afterEach(() => vi.restoreAllMocks());
it.each(["QUANTITY", "REVENUE"] as const)(
  "rejects shuffled snapshot-ID ties when ranking by %s",
  async (metric) => {
    const data = fixture();
    data.metric = metric;
    data.totalQuantity = 2;
    data.totalRevenue = "2.00";
    data.products = [
      {
        productSnapshotId: "saved-z",
        productName: "First",
        quantity: 1,
        revenue: "1.00",
      },
      {
        productSnapshotId: "saved-a",
        productName: "Second",
        quantity: 1,
        revenue: "1.00",
      },
    ];
    vi.spyOn(api, "get").mockResolvedValue({ data });
    await expect(
      getTopProducts(
        "shop",
        "2026-10-15",
        "2026-10-17",
        metric,
        new AbortController().signal,
      ),
    ).rejects.toThrow("could not be verified");
  },
);
it("reconciles top ten plus other products with full snapshot totals", async () => {
  const data = fixture();
  data.productCount = 12;
  data.totalQuantity = 12;
  data.totalRevenue = "11.25";
  data.otherQuantity = 2;
  data.otherRevenue = "1.25";
  data.products = Array.from({ length: 10 }, (_, i) => ({
    productSnapshotId: `saved-${i}`,
    productName: "Saved product",
    quantity: 1,
    revenue: "1.00",
  }));
  vi.spyOn(api, "get").mockResolvedValue({ data });
  expect(
    await getTopProducts(
      "shop",
      "2026-10-15",
      "2026-10-17",
      "QUANTITY",
      new AbortController().signal,
    ),
  ).toEqual(data);
});
it("accepts PostgreSQL C tie order for supplementary Unicode IDs rather than locale/UTF-16 order", async () => {
  const data = fixture();
  data.totalQuantity = 2;
  data.totalRevenue = "2.00";
  data.products = [
    {
      productSnapshotId: "\uE000",
      productName: "First",
      quantity: 1,
      revenue: "1.00",
    },
    {
      productSnapshotId: "\u{10000}",
      productName: "Second",
      quantity: 1,
      revenue: "1.00",
    },
  ];
  const get = vi.spyOn(api, "get").mockResolvedValue({ data });
  expect(
    await getTopProducts(
      "shop",
      "2026-10-15",
      "2026-10-17",
      "QUANTITY",
      new AbortController().signal,
    ),
  ).toEqual(data);
  const reversed = { ...data, products: [...data.products].reverse() };
  get.mockResolvedValue({ data: reversed });
  await expect(
    getTopProducts(
      "shop",
      "2026-10-15",
      "2026-10-17",
      "QUANTITY",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
it("keeps same-name products separate and requests date/metric with cancellation", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue({ data: fixture() });
  const signal = new AbortController().signal;
  expect(
    await getTopProducts(
      "shop",
      "2026-10-15",
      "2026-10-17",
      "QUANTITY",
      signal,
    ),
  ).toEqual(fixture());
  expect(get).toHaveBeenCalledWith(
    "/shops/shop/reports/top-products",
    expect.objectContaining({
      params: {
        startDate: "2026-10-15",
        endDate: "2026-10-17",
        metric: "QUANTITY",
      },
      signal,
    }),
  );
});
it("validates revenue ranking including zero-price items", async () => {
  const data = fixture();
  data.metric = "REVENUE";
  data.products.reverse();
  data.products[1].revenue = "0.00";
  data.totalRevenue = "10.00";
  vi.spyOn(api, "get").mockResolvedValue({ data });
  expect(
    (
      await getTopProducts(
        "shop",
        "2026-10-15",
        "2026-10-17",
        "REVENUE",
        new AbortController().signal,
      )
    ).products[1].revenue,
  ).toBe("0.00");
});
it.each([
  "shop",
  "date",
  "timezone",
  "metric",
  "missing",
  "duplicate",
  "sorting",
  "quantity",
  "revenue",
  "other",
  "identity",
  "name",
])("rejects inconsistent %s", async (kind) => {
  const data = fixture();
  if (kind === "shop") data.shopId = "foreign";
  if (kind === "date") data.startDate = "2026-10-14";
  if (kind === "timezone") data.timezone = "UTC" as never;
  if (kind === "metric") data.metric = "REVENUE";
  if (kind === "missing") data.products.pop();
  if (kind === "duplicate") data.products[1].productSnapshotId = "saved-a";
  if (kind === "sorting") data.products.reverse();
  if (kind === "quantity") data.totalQuantity++;
  if (kind === "revenue") data.totalRevenue = "11.01";
  if (kind === "other") data.otherQuantity = 1;
  if (kind === "identity") data.products[0].productSnapshotId = "";
  if (kind === "name") data.products[0].productName = "";
  vi.spyOn(api, "get").mockResolvedValue({ data });
  await expect(
    getTopProducts(
      "shop",
      "2026-10-15",
      "2026-10-17",
      "QUANTITY",
      new AbortController().signal,
    ),
  ).rejects.toThrow("could not be verified");
});
