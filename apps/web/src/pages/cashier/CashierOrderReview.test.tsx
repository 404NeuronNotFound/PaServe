import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashierOrderReview } from "./CashierOrderReview";
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
  items: [cashierLine],
};
it("displays saved items, modifiers, notes, type/table, total and statuses", () => {
  render(<CashierOrderReview order={order} onNext={vi.fn()} />);
  expect(
    screen.getByRole("heading", { name: "Review order" }),
  ).toHaveFocus();
  expect(screen.getByText("Dine-in · Table A3")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "2 × Saved Latte" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Large")).toBeInTheDocument();
  expect(screen.getByText("Oat milk")).toBeInTheDocument();
  expect(screen.getByText("Less ice. No lid.")).toBeInTheDocument();
  expect(screen.getByText("pending confirmation")).toBeInTheDocument();
  expect(screen.getByText("unpaid")).toBeInTheDocument();
  expect(screen.getAllByText("₱135.50")).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Order items (2 items)" })).toBeInTheDocument();
  expect(screen.getByText(/Check the items, options, customer notes and total/)).toBeInTheDocument();
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
