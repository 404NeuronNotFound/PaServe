import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import {
  AccessSkeleton,
  MenuSkeleton,
  ProductsSkeleton,
  OrderListSkeleton,
  ListSkeleton,
  MetricsSkeleton,
  ReportSkeleton,
  ProductDetailsSkeleton,
  ReceiptSkeleton,
  OrderDetailsSkeleton,
  PreparationMetricSkeleton,
  StaffSkeleton,
  FormSkeleton,
} from "./LoadingSkeleton";

afterEach(cleanup);

it.each([
  ["session", <AccessSkeleton label="Checking your session…" />],
  [
    "cashier access",
    <AccessSkeleton label="Checking cashier access…" view="cashier" />,
  ],
  [
    "kitchen access",
    <AccessSkeleton label="Checking kitchen access..." view="kitchen" />,
  ],
  [
    "invitation",
    <AccessSkeleton label="Checking your invitation…" view="invitation" />,
  ],
  ["menu", <MenuSkeleton />],
  ["products", <ProductsSkeleton />],
  ["orders", <OrderListSkeleton label="Loading orders" />],
  ["kitchen", <OrderListSkeleton label="Loading tickets" kitchen />],
  [
    "kitchen history",
    <OrderListSkeleton label="Loading history" kitchen history />,
  ],
  ["tables", <ListSkeleton label="Loading tables" tables />],
  ["metrics", <MetricsSkeleton />],
  ["reports", <ReportSkeleton label="Loading report" chart />],
  ["product details", <ProductDetailsSkeleton />],
  ["receipt", <ReceiptSkeleton />],
  ["tracking", <ReceiptSkeleton tracking />],
  ["order details", <OrderDetailsSkeleton />],
  ["preparation metric", <PreparationMetricSkeleton />],
  ["staff", <StaffSkeleton />],
  ["forms", <FormSkeleton label="Loading settings" />],
])(
  "announces %s loading once and hides placeholder content and actions",
  (_, element) => {
    const { container } = render(element);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).not.toBe("");
    const shapes = container.querySelector('[aria-busy="true"]');
    expect(shapes).toHaveAttribute("aria-hidden", "true");
    expect(shapes).not.toContainElement(screen.getByRole("status"));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
  },
);

it("leaves keyboard focus on the current control when a skeleton appears and disappears", async () => {
  const user = userEvent.setup();
  const view = (loading: boolean) => (
    <>
      <button>Refresh orders</button>
      {loading && <OrderListSkeleton label="Loading orders" />}
      <button>Next page</button>
    </>
  );
  const { rerender } = render(view(false));
  await user.tab();
  expect(screen.getByRole("button", { name: "Refresh orders" })).toHaveFocus();
  rerender(view(true));
  expect(screen.getByRole("button", { name: "Refresh orders" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "Next page" })).toHaveFocus();
  rerender(view(false));
  expect(screen.getByRole("button", { name: "Next page" })).toHaveFocus();
});

it.each(["grid", "list", "compact"] as const)(
  "uses the real %s layout and banner slot when known",
  (layout) => {
    const { container, rerender } = render(
      <MenuSkeleton layout={layout} banner count={2} />,
    );
    expect(screen.getByRole("main")).toHaveAttribute("data-layout", layout);
    expect(container.querySelectorAll(".menu-product-card")).toHaveLength(2);
    expect(
      container.querySelector(".menu-shop-hero .shop-banner"),
    ).not.toBeNull();
    rerender(<MenuSkeleton layout={layout} banner={false} count={2} />);
    expect(container.querySelector(".menu-shop-hero .shop-banner")).toBeNull();
  },
);
