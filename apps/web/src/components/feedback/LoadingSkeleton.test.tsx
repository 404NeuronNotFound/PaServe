import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, describe, beforeEach } from "vitest";
import {
  AccessSkeleton,
  MenuSkeleton,
  ProductsSkeleton,
  OrderListSkeleton,
  ListSkeleton,
  MetricsSkeleton,
  ReportSkeleton,
  ProductDetailsSkeleton,
  CustomizationSkeleton,
  ReceiptSkeleton,
  OrderDetailsSkeleton,
  PreparationMetricSkeleton,
  SalesReportSkeleton,
  StaffSkeleton,
  NotificationsSkeleton,
  FormSkeleton,
} from "./LoadingSkeleton";

describe.each(["day", "night"] as const)("%s appearance", (appearance) => {
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
    ["customization choices", <CustomizationSkeleton />],
    ["customization add-ons", <CustomizationSkeleton tab="addons" />],
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
    [
      "sales trends",
      <SalesReportSkeleton kind="trends" label="Loading trends" />,
    ],
    [
      "top products",
      <SalesReportSkeleton kind="products" label="Loading products" />,
    ],
    ["peak hours", <SalesReportSkeleton kind="hours" label="Loading hours" />],
    [
      "payments",
      <SalesReportSkeleton kind="payments" label="Loading payments" />,
    ],
    [
      "recent orders",
      <SalesReportSkeleton kind="recent" label="Loading recent orders" />,
    ],
    ["staff", <StaffSkeleton />],
    ["notifications", <NotificationsSkeleton />],
    ["forms", <FormSkeleton label="Loading settings" />],
  ])(
    "provides a quiet %s loading label and hides placeholder content and actions",
    (_, element) => {
      const { container } = render(element);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status").textContent).not.toBe("");
      expect(screen.getByRole("status")).toHaveAttribute("aria-live", "off");
      const shapes = container.querySelector('[aria-busy="true"]');
      expect(shapes).toHaveAttribute("aria-hidden", "true");
      expect(shapes).not.toContainElement(screen.getByRole("status"));
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading")).not.toBeInTheDocument();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(
        container.querySelector("button, a, input, [tabindex]"),
      ).toBeNull();
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
    expect(
      screen.getByRole("button", { name: "Refresh orders" }),
    ).toHaveFocus();
    rerender(view(true));
    expect(
      screen.getByRole("button", { name: "Refresh orders" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Next page" })).toHaveFocus();
    rerender(view(false));
    expect(screen.getByRole("button", { name: "Next page" })).toHaveFocus();
  });

  it("reserves separate scrollable body and footer regions for product details", () => {
    const { container } = render(<ProductDetailsSkeleton />);
    const region = container.querySelector('[aria-busy="true"]')!;
    const body = region.querySelector(".customer-dialog-body")!;
    const footer = region.querySelector(".customer-dialog-footer")!;
    expect(body.parentElement).toBe(footer.parentElement);
    expect(
      body.querySelector(
        ".product-details-summary .product-details-placeholder",
      ),
    ).not.toBeNull();
    expect(footer.querySelector(".skeleton-product-submit")).not.toBeNull();
    expect(footer.querySelector("button, input")).toBeNull();
  });

  it("matches the selected customization section without fake tabs or editable controls", () => {
    const { container, rerender } = render(<CustomizationSkeleton />);
    expect(container.querySelectorAll(".customization-group")).toHaveLength(2);
    expect(container.querySelector(".customization-tabs")).not.toBeNull();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    rerender(<CustomizationSkeleton tab="addons" />);
    expect(container.querySelectorAll(".product-addon-row")).toHaveLength(3);
    expect(container.querySelector(".customization-group")).toBeNull();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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
      expect(
        container.querySelector(".menu-shop-hero .shop-banner"),
      ).toBeNull();
    },
  );

  beforeEach(() => {
    document.documentElement.dataset.appearance = appearance;
  });
  afterEach(() => {
    delete document.documentElement.dataset.appearance;
  });
});
