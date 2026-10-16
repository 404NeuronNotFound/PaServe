import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReceiptOrderItems } from "./ReceiptOrderItems";
import { cashierLine } from "../../test/cashier-fixtures";

afterEach(cleanup);
it("lists each saved line separately with quantity, product, options and line total", () => {
  render(<ReceiptOrderItems items={[cashierLine, {
    ...cashierLine, variants: [], addOns: [], notes: undefined,
    unitPrice: "50.00", totalPrice: "100.00",
  }]} />);
  const section = screen.getByRole("region", { name: "Order items" });
  const lines = within(section).getAllByRole("heading", { name: "2 × Saved Latte" });
  expect(lines).toHaveLength(2);
  const first = within(lines[0].closest("li")!);
  expect(first.getByText("Large")).toBeInTheDocument();
  expect(first.getByText("Oat milk")).toBeInTheDocument();
  expect(first.getByText("Line total: ₱135.50")).toBeInTheDocument();
  expect(first.getByText("Customer note: Less ice. No lid.")).toBeInTheDocument();
  const second = within(lines[1].closest("li")!);
  expect(second.getByText("No modifiers selected.")).toBeInTheDocument();
  expect(second.getByText("Line total: ₱100.00")).toBeInTheDocument();
});
it("shows explicit unavailability for older saved receipts", () => {
  render(<ReceiptOrderItems />);
  expect(screen.getByText("Item details are unavailable in this saved receipt.")).toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});
it("keeps zero totals and treats snapshot names as text", () => {
  render(<ReceiptOrderItems items={[{ ...cashierLine, productName: "<script>old name</script>",
    quantity: 1, basePrice: "0.00", unitPrice: "0.00", totalPrice: "0.00", variants: [], addOns: [],
  }]} />);
  expect(screen.getByRole("heading", { name: "1 × <script>old name</script>" })).toBeInTheDocument();
  expect(screen.getByText("Line total: ₱0.00")).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
});
