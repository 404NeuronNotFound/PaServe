import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashierOrderReview } from "./CashierOrderReview";
it("shows dine-in counter pickup to the cashier without changing the order type", () => {
  render(<CashierOrderReview order={{ ...order, serviceType: "COUNTER_PICKUP" }} onNext={vi.fn()} />);
  expect(screen.getByText("Dine-in · Table A3 · Counter pickup")).toBeVisible();
});
import { cashierLine } from "../../test/cashier-fixtures";
import type { VerifyOrderQrResponse } from "@paserve/contracts";

const order: VerifyOrderQrResponse["order"] = {
  id: "order-a",
  shopId: "shop-a",
  orderNumber: "ORD-000042",
  mode: "DINE_IN",
  tableNumber: "A3",
  currency: "PHP",
  totalPrice: "135.50",
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  reviewVersion: "a".repeat(64),
  items: [cashierLine],
};
it.each(["review", "payment"] as const)(
  "anchors a single refresh control beside the summary heading for %s",
  async (purpose) => {
    const refresh = vi.fn();
    render(
      <CashierOrderReview
        order={order}
        onNext={vi.fn()}
        purpose={purpose}
        refresh={{
          label: "Refresh order",
          pending: false,
          disabled: false,
          onClick: refresh,
        }}
      />,
    );
    const header = within(
      screen.getByRole("group", { name: "Order summary tools" }),
    );
    expect(header.getByText("AT A GLANCE")).toBeVisible();
    await userEvent
      .setup()
      .click(header.getByRole("button", { name: "Refresh order" }));
    expect(
      screen.getAllByRole("button", { name: "Refresh order" }),
    ).toHaveLength(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);
it.each(["ORD-000042", "ORD-1000000", "ORD-9223372036854775807"])(
  "displays the complete saved receipt/kitchen reference %s in cashier review",
  (orderNumber) => {
    render(
      <CashierOrderReview order={{ ...order, orderNumber }} onNext={vi.fn()} />,
    );
    expect(screen.getByText(orderNumber)).toBeVisible();
  },
);
it("displays saved items, modifiers, notes, type/table, total and statuses", () => {
  render(<CashierOrderReview order={order} onNext={vi.fn()} />);
  expect(screen.getByText("ORD-000042")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Review order" })).toHaveFocus();
  expect(screen.getByText("Dine-in · Table A3 · Table service")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "2 × Saved Latte" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Large")).toBeInTheDocument();
  expect(screen.getByText("Oat milk")).toBeInTheDocument();
  expect(screen.getByText("Less ice. No lid.")).toBeInTheDocument();
  expect(screen.getByText("Pending confirmation")).toBeInTheDocument();
  expect(screen.getByText("Unpaid")).toBeInTheDocument();
  expect(screen.getAllByText("₱135.50")).toHaveLength(2);
  expect(
    screen.getByRole("heading", { name: "Order items (2 items)" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Check the items, options, customer notes and total/),
  ).toBeInTheDocument();
  expect(screen.getByText("Order total (PHP)")).toBeInTheDocument();
});
it("keeps repeated products as separate lines, including a plain line without notes", () => {
  render(
    <CashierOrderReview
      order={{
        ...order,
        mode: "TAKEOUT",
        tableNumber: null,
        totalPrice: "235.50",
        items: [
          cashierLine,
          {
            ...cashierLine,
            variants: [],
            addOns: [],
            notes: undefined,
            unitPrice: "50.00",
            totalPrice: "100.00",
          },
        ],
      }}
      onNext={vi.fn()}
    />,
  );
  expect(
    screen.getAllByRole("heading", { name: "2 × Saved Latte" }),
  ).toHaveLength(2);
  expect(screen.getByText("No modifiers selected.")).toBeInTheDocument();
  expect(screen.getByText("Takeout / pickup")).toBeInTheDocument();
  expect(
    screen.getAllByRole("heading", { name: "Customer note" }),
  ).toHaveLength(1);
});
it("renders customer notes as text and allows scanning another order", async () => {
  const next = vi.fn();
  const view = render(
    <CashierOrderReview
      order={{
        ...order,
        items: [{ ...cashierLine, notes: "<script>doSomething()</script>" }],
      }}
      onNext={next}
    />,
  );
  expect(
    screen.getByText("<script>doSomething()</script>"),
  ).toBeInTheDocument();
  expect(view.container.querySelector("script")).toBeNull();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Scan another order" }));
  expect(next).toHaveBeenCalledTimes(1);
});
