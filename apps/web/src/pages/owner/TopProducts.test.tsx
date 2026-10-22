import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TopProductsResponse } from "@paserve/contracts";
import { getTopProducts } from "../../features/orders/top-products";
import { TopProducts } from "./TopProducts";
vi.mock("../../features/orders/top-products", () => ({
  getTopProducts: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const data: TopProductsResponse = {
  shopId: "shop",
  startDate: "2026-10-15",
  endDate: "2026-10-17",
  from: "2026-10-14T16:00:00.000Z",
  to: "2026-10-17T16:00:00.000Z",
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
};
function setup(compact = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <TopProducts
        compact={compact}
        userId="user"
        shopId="shop"
        startDate="2026-10-15"
        endDate="2026-10-17"
      />
    </QueryClientProvider>,
  );
}
it("shows five ranked bars and expands the complete table in compact mode", async () => {
  vi.mocked(getTopProducts).mockResolvedValue({
    ...data,
    productCount: 6,
    products: Array.from({ length: 6 }, (_, i) => ({
      productSnapshotId: `saved-${i}`,
      productName: `Product ${i + 1}`,
      quantity: 6 - i,
      revenue: `${6 - i}.00`,
    })),
  });
  setup(true);
  const chart = await screen.findByRole("list", { name: "Top five products" });
  expect(chart.querySelectorAll("li")).toHaveLength(5);
  expect(chart).toHaveTextContent("Product 1");
  expect(chart).not.toHaveTextContent("Product 6");
  expect(chart.querySelector(".sales-product-bar > span")).toHaveStyle({
    width: "100%",
  });
  expect(
    screen.getByText("View product details").closest("details"),
  ).not.toHaveAttribute("open");
  fireEvent.click(screen.getByText("View product details"));
  expect(screen.getByRole("table")).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent("Product 6");
});
it("shows saved names, references for duplicates and switches ranking metric", async () => {
  vi.mocked(getTopProducts).mockResolvedValue(data);
  setup();
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("Product reference: saved-a");
  expect(table).toHaveTextContent("Product reference: saved-b");
  expect(table).toHaveTextContent("All products");
  expect(table).toHaveTextContent("₱11.00");
  fireEvent.change(screen.getByLabelText("Rank by"), {
    target: { value: "REVENUE" },
  });
  await waitFor(() =>
    expect(getTopProducts).toHaveBeenLastCalledWith(
      "shop",
      "2026-10-15",
      "2026-10-17",
      "REVENUE",
      expect.any(AbortSignal),
    ),
  );
});
it("hides old rankings when refresh fails and supports retry", async () => {
  vi.mocked(getTopProducts)
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(data);
  setup();
  await screen.findByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Refresh top products" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t refresh top products",
  );
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh top products" }));
  expect(await screen.findByRole("table")).toBeVisible();
});
it("shows the remainder and complete totals when more than ten products exist", async () => {
  vi.mocked(getTopProducts).mockResolvedValue({
    ...data,
    productCount: 12,
    totalQuantity: 12,
    totalRevenue: "11.25",
    otherQuantity: 2,
    otherRevenue: "1.25",
    products: Array.from({ length: 10 }, (_, i) => ({
      productSnapshotId: `saved-${i}`,
      productName: `Product ${i}`,
      quantity: 1,
      revenue: "1.00",
    })),
  });
  setup();
  const table = await screen.findByRole("table");
  expect(table).toHaveTextContent("Other products (2)");
  expect(table).toHaveTextContent("₱1.25");
  expect(table).toHaveTextContent("₱11.25");
});
it("shows an empty state without inventing products", async () => {
  vi.mocked(getTopProducts).mockResolvedValue({
    ...data,
    products: [],
    productCount: 0,
    totalQuantity: 0,
    totalRevenue: "0.00",
  });
  setup();
  expect(
    await screen.findByText("No eligible item snapshots in this period."),
  ).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  vi.mocked(getTopProducts).mockResolvedValue(data);
  fireEvent.click(
    screen.getByRole("button", { name: "Check for new product sales" }),
  );
  expect(await screen.findByRole("table")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "No product sales to rank." }),
  ).not.toBeInTheDocument();
});
