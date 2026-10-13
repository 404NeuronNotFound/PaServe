import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CashierCashPayment } from "./CashierCashPayment";
import {
  reviewCashPayment,
  collectCashPayment,
} from "../../features/cashier/cash-payment";
import { cashierLine } from "../../test/cashier-fixtures";
vi.mock("../../features/cashier/cash-payment", async (original) => ({
  ...(await original<typeof import("../../features/cashier/cash-payment")>()),
  reviewCashPayment: vi.fn(),
  collectCashPayment: vi.fn(),
}));
const order = {
  id: "order-a",
  shopId: "shop-a",
  orderNumber: "ORD-000042",
  mode: "TAKEOUT" as const,
  tableNumber: null,
  currency: "PHP",
  totalPrice: "135.50",
  status: "CONFIRMED",
  paymentStatus: "UNPAID",
  items: [cashierLine],
  reviewVersion: "a".repeat(64),
};
const review = { order, payment: null };
const paid = {
  order: { ...order, paymentStatus: "PAID" },
  payment: {
    method: "CASH" as const,
    requestId: "58bb31e6-9c13-4c07-9e04-fbb29b0584ab",
    amountReceived: "200.00",
    changeDue: "64.50",
    paidAt: "2026-10-13T00:00:00.000Z",
    paidBy: "cashier",
  },
};
const originalModal = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "showModal",
  ),
  originalClose = Object.getOwnPropertyDescriptor(
    HTMLDialogElement.prototype,
    "close",
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(reviewCashPayment).mockResolvedValue(review);
  vi.mocked(collectCashPayment).mockResolvedValue(paid);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
});
afterEach(() => {
  cleanup();
  if (originalModal)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      originalModal,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose)
    Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
async function setup() {
  const next = vi.fn(),
    user = userEvent.setup();
  render(
    <CashierCashPayment
      shopId={order.shopId}
      orderId={order.id}
      onNext={next}
    />,
  );
  await screen.findByLabelText("Amount received (PHP)");
  return { user, next };
}
it("loads server total, previews exact change and records only after deliberate confirmation", async () => {
  const { user, next } = await setup();
  await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
  expect(screen.getByText("₱64.50")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Record cash payment" }));
  const dialog = await screen.findByRole("dialog");
  expect(collectCashPayment).not.toHaveBeenCalled();
  expect(reviewCashPayment).toHaveBeenCalledTimes(2);
  await user.click(
    within(dialog).getByRole("button", { name: "Record cash payment" }),
  );
  await screen.findByRole("heading", { name: "Cash payment recorded" });
  expect(screen.getByText("Return the change to the customer.")).toBeVisible();
  expect(collectCashPayment).toHaveBeenCalledWith(
    order.shopId,
    order.id,
    {
      requestId: expect.any(String),
      reviewVersion: order.reviewVersion,
      amountReceived: "200.00",
    },
    expect.any(AbortSignal),
  );
  expect(
    screen.queryByLabelText("Amount received (PHP)"),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Scan another order" }));
  expect(next).toHaveBeenCalledTimes(1);
});
it.each(["100", "-1", "200.001", "1e3"])(
  "blocks insufficient/malformed amount %s",
  async (value) => {
    const { user } = await setup();
    await user.type(screen.getByLabelText("Amount received (PHP)"), value);
    expect(screen.getByLabelText("Amount received (PHP)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByLabelText("Amount received (PHP)")).toHaveAccessibleDescription(
      expect.stringContaining(
        value === "100"
          ? "The amount received is below the order total."
          : "Enter a valid amount with up to two decimal places.",
      ),
    );
    expect(
      screen.getByRole("button", { name: "Record cash payment" }),
    ).toBeDisabled();
    expect(collectCashPayment).not.toHaveBeenCalled();
  },
);
it("requires new review and amount after stale details", async () => {
  const { user } = await setup();
  await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
  vi.mocked(reviewCashPayment).mockResolvedValue({
    order: { ...order, reviewVersion: "b".repeat(64) },
    payment: null,
  });
  await user.click(screen.getByRole("button", { name: "Record cash payment" }));
  await screen.findByText(/The order changed/);
  expect(screen.getByLabelText("Amount received (PHP)")).toHaveValue("");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(collectCashPayment).not.toHaveBeenCalled();
});
it("shows existing paid receipt and prevents another collection", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  render(
    <CashierCashPayment
      shopId={order.shopId}
      orderId={order.id}
      onNext={vi.fn()}
    />,
  );
  await screen.findByRole("heading", { name: "Cash payment recorded" });
  expect(screen.getByText(/already has a saved cash payment/)).toBeVisible();
  expect(
    screen.queryByText("Return the change to the customer."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Record cash payment" }),
  ).not.toBeInTheDocument();
  expect(collectCashPayment).not.toHaveBeenCalled();
});
it("locks uncertain payment until explicit refresh recovers saved paid state", async () => {
  const { user } = await setup();
  await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
  await user.click(screen.getByRole("button", { name: "Record cash payment" }));
  const dialog = await screen.findByRole("dialog");
  vi.mocked(collectCashPayment).mockRejectedValue(
    new Error("Connection lost."),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Record cash payment" }),
  );
  await screen.findByText(/payment result is unconfirmed/);
  expect(
    screen.getByRole("button", { name: "Record cash payment" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Amount received (PHP)")).toBeDisabled();
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  await user.click(screen.getByRole("button", { name: "Refresh payment" }));
  await screen.findByRole("heading", { name: "Cash payment recorded" });
  expect(collectCashPayment).toHaveBeenCalledTimes(1);
});
it("blocks failed initial review and allows explicit recovery", async () => {
  vi.mocked(reviewCashPayment).mockRejectedValue(
    new Error("Access unavailable."),
  );
  const user = userEvent.setup();
  render(
    <CashierCashPayment
      shopId={order.shopId}
      orderId={order.id}
      onNext={vi.fn()}
    />,
  );
  await screen.findByText("Access unavailable.");
  expect(
    screen.queryByLabelText("Amount received (PHP)"),
  ).not.toBeInTheDocument();
  vi.mocked(reviewCashPayment).mockResolvedValue(review);
  await user.click(screen.getByRole("button", { name: "Refresh payment" }));
  await screen.findByLabelText("Amount received (PHP)");
  expect(screen.queryByText(/The order changed/)).not.toBeInTheDocument();
});
it("aborts pending review when leaving the flow", async () => {
  vi.mocked(reviewCashPayment).mockImplementation(() => new Promise(() => {}));
  const view = render(
    <CashierCashPayment
      shopId={order.shopId}
      orderId={order.id}
      onNext={vi.fn()}
    />,
  );
  await waitFor(() => expect(reviewCashPayment).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(reviewCashPayment).mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
});
