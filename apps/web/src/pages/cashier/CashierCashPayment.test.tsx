import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  render,
  act,
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
  recordManualGcashPayment,
  recordManualCardPayment,
  recordOtherPayment,
} from "../../features/cashier/cash-payment";
import { cashierLine } from "../../test/cashier-fixtures";
vi.mock("../../features/cashier/cash-payment", async (original) => ({
  ...(await original<typeof import("../../features/cashier/cash-payment")>()),
  reviewCashPayment: vi.fn(),
  collectCashPayment: vi.fn(),
  recordManualGcashPayment: vi.fn(),
  recordManualCardPayment: vi.fn(),
  recordOtherPayment: vi.fn(),
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
async function choosePaymentMethod(user: ReturnType<typeof userEvent.setup>, value: string) {
  const labels: Record<string, string> = { CASH: 'Cash', GCASH_MANUAL: 'GCash (manual)', CARD_MANUAL: 'Card (manual)', OTHER: 'Other (manual)' };
  await user.click(screen.getByRole('combobox', { name: 'Payment method' }));
  await user.click(screen.getByRole('option', { name: labels[value] }));
}
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
  vi.restoreAllMocks();
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
it("offers printing only after loading a saved paid receipt", async () => {
  render(<CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />);
  await screen.findByRole("button", { name: "Record cash payment" });
  expect(screen.queryByRole("button", { name: "Print receipt" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Print layout")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "View receipt" })).not.toBeInTheDocument();
});
it("sends one payment operation when its confirmation is double-clicked", async () => {
  let finish!: (value: typeof paid) => void;
  vi.mocked(collectCashPayment).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { user } = await setup();
  await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
  await user.click(screen.getByRole("button", { name: "Record cash payment" }));
  const dialog = await screen.findByRole("dialog");
  await user.dblClick(within(dialog).getByRole("button", { name: "Record cash payment" }));
  expect(collectCashPayment).toHaveBeenCalledOnce();
  const requestId = vi.mocked(collectCashPayment).mock.calls[0][2].requestId;
  await act(async () => { finish({ ...paid, payment: { ...paid.payment, requestId } }); });
  expect(await screen.findByRole("button", { name: "View receipt" })).toBeEnabled();
  expect(collectCashPayment).toHaveBeenCalledOnce();
});
it("unlocks View receipt only after the payment save succeeds, and returns to the payment summary", async () => {
  let resolvePayment!: (value: typeof paid) => void;
  vi.mocked(collectCashPayment).mockImplementation(() => new Promise((resolve) => { resolvePayment = resolve; }));
  const { user } = await setup();
  await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
  await user.click(screen.getByRole("button", { name: "Record cash payment" }));
  const dialog = await screen.findByRole("dialog");
  expect(screen.queryByRole("button", { name: "View receipt" })).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Record cash payment" }));
  await waitFor(() => expect(collectCashPayment).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "View receipt" })).not.toBeInTheDocument();
  resolvePayment(paid);
  await user.click(await screen.findByRole("button", { name: "View receipt" }));
  expect(screen.getByRole("region", { name: "Order receipt" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Receipt ORD-000042" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Back to payment" }));
  expect(screen.queryByRole("region", { name: "Order receipt" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Print receipt" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View receipt" })).toBeInTheDocument();
  expect(collectCashPayment).toHaveBeenCalledOnce();
});
it.each(["standard", "thermal-80", "thermal-58"])(
  "prints the saved cashier receipt using %s without payment mutations",
  async (layout) => {
    vi.mocked(reviewCashPayment).mockResolvedValue(paid);
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Print receipt" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "View receipt" }));
    await screen.findByRole("button", { name: "Print receipt" });
    const reads = vi.mocked(reviewCashPayment).mock.calls.length;
    await userEvent.selectOptions(screen.getByLabelText("Print layout"), layout);
    expect(screen.getByRole("region", { name: "Receipt ORD-000042" })).toHaveAttribute("data-print-layout", layout);
    await userEvent.click(screen.getByRole("button", { name: "Print receipt" }));
    expect(print).toHaveBeenCalledExactlyOnceWith();
    expect(reviewCashPayment).toHaveBeenCalledTimes(reads);
    expect(collectCashPayment).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "2 × Saved Latte" })).toBeInTheDocument();
    expect(screen.getByText("Large")).toBeInTheDocument();
    expect(screen.getByText("Oat milk")).toBeInTheDocument();
    expect(screen.getByText("Line total: ₱135.50")).toBeInTheDocument();
    expect(screen.getByText("Amount received (PHP): ₱200.00")).toBeInTheDocument();
    expect(screen.getByText("Change (PHP): ₱64.50")).toBeInTheDocument();
  },
);
it("retains the saved cashier receipt when the print dialog fails", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  vi.spyOn(window, "print").mockImplementation(() => { throw new Error("Blocked"); });
  render(<CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "View receipt" }));
  await userEvent.click(await screen.findByRole("button", { name: "Print receipt" }));
  expect(screen.getByText(/Could not open the print dialog/)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Receipt ORD-000042" })).toBeInTheDocument();
});
it("closes the paid receipt and prevents printing after access refresh fails", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "View receipt" }));
  vi.mocked(reviewCashPayment).mockRejectedValue(new Error("Access unavailable."));
  act(() => window.dispatchEvent(new Event("focus")));
  await screen.findByText("Access unavailable.");
  expect(screen.queryByRole("button", { name: "Print receipt" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "View receipt" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Order receipt" })).not.toBeInTheDocument();
  expect(print).not.toHaveBeenCalled();
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  await userEvent.click(screen.getByRole("button", { name: "Refresh payment" }));
  expect(await screen.findByRole("button", { name: "View receipt" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Print receipt" })).not.toBeInTheDocument();
});
it("disables printing while the cashier receipt access check is pending", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  render(<CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "View receipt" }));
  let finish!: (value: typeof paid) => void;
  vi.mocked(reviewCashPayment).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  act(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => expect(screen.getByRole("button", { name: "Print receipt" })).toBeDisabled());
  await userEvent.click(screen.getByRole("button", { name: "Print receipt" }));
  expect(print).not.toHaveBeenCalled();
  await act(async () => { finish(paid); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Print receipt" })).toBeEnabled());
});
it("shows preparation queue state only from a saved paid receipt", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue({
    ...paid,
    queue: { status: "QUEUED", queuedAt: paid.payment.paidAt },
  });
  render(
    <CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />,
  );
  expect(await screen.findByText("Queued for preparation.")).toBeVisible();
  expect(screen.getByText('Payment recorded (Asia/Manila)')).toBeInTheDocument();
  expect(screen.getByText(/Oct 13, 2026.*08:00:00.*AM.*GMT\+8/)).toBeInTheDocument();
});
it.each(["GCASH_MANUAL", "OTHER"] as const)("redacts credentials from the %s payment summary and receipt", async (method) => {
  vi.mocked(reviewCashPayment).mockResolvedValue({ ...paid,
    payment: { ...paid.payment, method, amountReceived: order.totalPrice, changeDue: "0.00",
      reference: "4111.1111.1111.1111", description: method === "OTHER" ? "password private-payment-secret" : null },
  });
  render(<CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />);
  const view = await screen.findByRole("button", { name: "View receipt" });
  expect(screen.queryByText(/4111/)).not.toBeInTheDocument();
  expect(screen.queryByText(/private-payment-secret/)).not.toBeInTheDocument();
  await userEvent.click(view);
  expect(screen.queryByText(/4111/)).not.toBeInTheDocument();
  expect(screen.queryByText(/private-payment-secret/)).not.toBeInTheDocument();
});
it("reopens a saved card payment as a paid receipt without collection instructions", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue({
    ...paid,
    payment: {
      ...paid.payment,
      method: "CARD_MANUAL",
      amountReceived: order.totalPrice,
      changeDue: "0.00",
    },
  });
  render(
    <CashierCashPayment shopId="shop-a" orderId="order-a" onNext={vi.fn()} />,
  );
  // Reopened receipts display the saved method without collection instructions.
  expect(
    await screen.findByRole("heading", {
      name: "Card payment recorded manually",
    }),
  ).toBeVisible();
  expect(screen.getByText("ORD-000042 is paid.")).toBeVisible();
  expect(
    screen.queryByText("Awaiting confirmation and payment"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "Check the saved total, collect the cash and return any change.",
    ),
  ).not.toBeInTheDocument();
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
it("fills exact tender without recording payment and keeps the amount editable", async () => {
  const { user } = await setup();
  const shortcuts = screen.getByRole("group", { name: "Cash amount shortcuts" });
  await user.click(within(shortcuts).getByRole("button", { name: /^Exact/ }));
  const input = screen.getByLabelText("Amount received (PHP)");
  expect(input).toHaveValue("135.50");
  expect(input).toHaveFocus();
  expect(screen.getByText("Change due").parentElement).toHaveTextContent("0.00");
  expect(collectCashPayment).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.clear(input);
  await user.type(input, "150");
  expect(input).toHaveValue("150");
  expect(screen.getByText("Change due").parentElement).toHaveTextContent("14.50");
});
it("offers only sufficient bills and still requires explicit payment confirmation", async () => {
  const { user } = await setup();
  const shortcuts = screen.getByRole("group", { name: "Cash amount shortcuts" });
  expect(within(shortcuts).getAllByRole("button")).toHaveLength(4);
  expect(within(shortcuts).queryByRole("button", { name: /^₱100\.00$/ })).not.toBeInTheDocument();
  await user.click(within(shortcuts).getByRole("button", { name: /^₱200\.00$/ }));
  expect(screen.getByLabelText("Amount received (PHP)")).toHaveValue("200.00");
  expect(collectCashPayment).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Record cash payment" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("64.50");
  expect(within(shortcuts).getAllByRole("button").every((button) => button.hasAttribute("disabled"))).toBe(true);
  expect(collectCashPayment).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Record cash payment" }));
  await waitFor(() => expect(collectCashPayment).toHaveBeenCalledOnce());
});
it("does not duplicate exact tender when the total is a suggested bill", async () => {
  vi.mocked(reviewCashPayment).mockResolvedValue({ ...review, order: { ...order, totalPrice: "500.00" } });
  await setup();
  const shortcuts = screen.getByRole("group", { name: "Cash amount shortcuts" });
  expect(within(shortcuts).getAllByRole("button")).toHaveLength(2);
  expect(within(shortcuts).getByRole("button", { name: /^Exact/ })).toHaveTextContent("500.00");
});
const otherPaid = {
  ...paid,
  payment: {
    ...paid.payment,
    method: "OTHER" as const,
    amountReceived: "135.50",
    changeDue: "0.00",
    description: "Bank transfer",
    reference: "00001234 receipt",
  },
};
it("requires a description and attestation for OTHER and displays the saved method details", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "OTHER");
  expect(
    screen.getByRole("button", { name: "Record other payment" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", {
      name: /full payment was received using this shop-specific method/,
    }),
  );
  expect(
    screen.getByRole("button", { name: "Record other payment" }),
  ).toBeDisabled();
  await user.type(
    screen.getByLabelText("Payment method description"),
    "Bank transfer",
  );
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await user.type(
    screen.getByLabelText("Reference note / number (optional)"),
    otherPaid.payment.reference,
  );
  await user.click(screen.getByRole("checkbox"));
  vi.mocked(recordOtherPayment).mockResolvedValue(otherPaid);
  await user.click(
    screen.getByRole("button", { name: "Record other payment" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(recordOtherPayment).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Record other payment" }),
  );
  await screen.findByRole("heading", {
    name: "Other payment recorded manually",
  });
  expect(screen.getByText("Bank transfer")).toBeVisible();
  expect(screen.getByText(otherPaid.payment.reference)).toBeVisible();
  expect(
    screen.queryByText("Return the change to the customer."),
  ).not.toBeInTheDocument();
  expect(recordOtherPayment).toHaveBeenCalledWith(
    order.shopId,
    order.id,
    expect.objectContaining({
      description: "Bank transfer",
      reference: otherPaid.payment.reference,
      receivedConfirmed: true,
    }),
    expect.any(AbortSignal),
  );
});
it("rejects common card details in OTHER and recovers uncertain saves", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "OTHER");
  await user.type(
    screen.getByLabelText("Payment method description"),
    "Bank transfer",
  );
  await user.type(
    screen.getByLabelText("Reference note / number (optional)"),
    "4111111111111111",
  );
  await user.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "Record other payment" }),
  ).toBeDisabled();
  await user.clear(screen.getByLabelText("Reference note / number (optional)"));
  await user.click(
    screen.getByRole("button", { name: "Record other payment" }),
  );
  vi.mocked(recordOtherPayment).mockRejectedValue(
    new Error("Connection lost."),
  );
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Record other payment",
    }),
  );
  await screen.findByText(/payment result is unconfirmed/);
  expect(
    screen.getByRole("button", { name: "Record other payment" }),
  ).toBeDisabled();
  vi.mocked(reviewCashPayment).mockResolvedValue(otherPaid);
  await user.click(screen.getByRole("button", { name: "Refresh payment" }));
  await screen.findByRole("heading", {
    name: "Other payment recorded manually",
  });
  expect(recordOtherPayment).toHaveBeenCalledTimes(1);
});
const cardPaid = {
  ...paid,
  payment: {
    ...paid.payment,
    method: "CARD_MANUAL" as const,
    amountReceived: "135.50",
    changeDue: "0.00",
    reference: "00001234 terminal receipt",
  },
};
it("records card only after external completion attestation and confirmation", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "CARD_MANUAL");
  expect(
    screen.queryByLabelText("Amount received (PHP)"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Record card payment" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/No gateway verification is performed/),
  ).toBeVisible();
  await user.type(
    screen.getByLabelText("Reference note / number (optional)"),
    cardPaid.payment.reference,
  );
  await user.click(
    screen.getByRole("checkbox", {
      name: /I verified the full card payment completed/,
    }),
  );
  vi.mocked(recordManualCardPayment).mockResolvedValue(cardPaid);
  await user.click(screen.getByRole("button", { name: "Record card payment" }));
  const dialog = await screen.findByRole("dialog");
  expect(recordManualCardPayment).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Record card payment" }),
  );
  await screen.findByRole("heading", {
    name: "Card payment recorded manually",
  });
  expect(screen.getByText(cardPaid.payment.reference)).toBeVisible();
  expect(
    screen.getByText(/No gateway verification was performed/),
  ).toBeVisible();
  expect(
    screen.queryByText("Return the change to the customer."),
  ).not.toBeInTheDocument();
  expect(recordManualCardPayment).toHaveBeenCalledWith(
    order.shopId,
    order.id,
    expect.objectContaining({
      reference: cardPaid.payment.reference,
      receivedConfirmed: true,
    }),
    expect.any(AbortSignal),
  );
  expect(collectCashPayment).not.toHaveBeenCalled();
  expect(recordManualGcashPayment).not.toHaveBeenCalled();
});
it("recovers uncertain card recording through an explicit saved-state refresh", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "CARD_MANUAL");
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "Record card payment" }));
  vi.mocked(recordManualCardPayment).mockRejectedValue(
    new Error("Connection lost."),
  );
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Record card payment",
    }),
  );
  await screen.findByText(/payment result is unconfirmed/);
  expect(
    screen.getByRole("button", { name: "Record card payment" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Payment method")).toBeDisabled();
  vi.mocked(reviewCashPayment).mockResolvedValue(cardPaid);
  await user.click(screen.getByRole("button", { name: "Refresh payment" }));
  await screen.findByRole("heading", {
    name: "Card payment recorded manually",
  });
  expect(recordManualCardPayment).toHaveBeenCalledTimes(1);
});
it("clears external card attestation on changed review and method switch", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "CARD_MANUAL");
  await user.click(screen.getByRole("checkbox"));
  vi.mocked(reviewCashPayment).mockResolvedValue({
    order: { ...order, reviewVersion: "b".repeat(64) },
    payment: null,
  });
  await user.click(screen.getByRole("button", { name: "Record card payment" }));
  await screen.findByText(/verify external card completion again/);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox"));
  await choosePaymentMethod(user, "GCASH_MANUAL");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(recordManualCardPayment).not.toHaveBeenCalled();
});
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
  expect(screen.getByText("₱64.50")).toBeVisible();
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
    expect(
      screen.getByLabelText("Amount received (PHP)"),
    ).toHaveAccessibleDescription(
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
  expect(screen.getByText("₱64.50")).toBeVisible();
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
const gcashPaid = {
  ...paid,
  payment: {
    ...paid.payment,
    method: "GCASH_MANUAL" as const,
    amountReceived: "135.50",
    changeDue: "0.00",
  },
};
it("requires manual receipt verification and dialog confirmation before recording GCash", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "GCASH_MANUAL");
  expect(
    screen.queryByLabelText("Amount received (PHP)"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Record GCash payment" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: /I verified the full payment/ }),
  );
  vi.mocked(recordManualGcashPayment).mockResolvedValue(gcashPaid);
  await user.click(
    screen.getByRole("button", { name: "Record GCash payment" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(recordManualGcashPayment).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Record GCash payment" }),
  );
  await screen.findByRole("heading", {
    name: "GCash payment recorded manually",
  });
  expect(recordManualGcashPayment).toHaveBeenCalledWith(
    order.shopId,
    order.id,
    {
      requestId: expect.any(String),
      reviewVersion: order.reviewVersion,
      receivedConfirmed: true,
    },
    expect.any(AbortSignal),
  );
  expect(collectCashPayment).not.toHaveBeenCalled();
  expect(
    screen.queryByText("Return the change to the customer."),
  ).not.toBeInTheDocument();
});
it("blocks uncertain GCash saves and recovers the saved method on refresh", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "GCASH_MANUAL");
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: "Record GCash payment" }),
  );
  vi.mocked(recordManualGcashPayment).mockRejectedValue(
    new Error("Connection lost."),
  );
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Record GCash payment",
    }),
  );
  await screen.findByText(/payment result is unconfirmed/);
  expect(screen.getByLabelText("Payment method")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Record GCash payment" }),
  ).toBeDisabled();
  vi.mocked(reviewCashPayment).mockResolvedValue(gcashPaid);
  await user.click(screen.getByRole("button", { name: "Refresh payment" }));
  await screen.findByRole("heading", {
    name: "GCash payment recorded manually",
  });
  expect(recordManualGcashPayment).toHaveBeenCalledTimes(1);
});
it("clears GCash attestation when refreshed order details change", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "GCASH_MANUAL");
  await user.click(screen.getByRole("checkbox"));
  vi.mocked(reviewCashPayment).mockResolvedValue({
    order: { ...order, reviewVersion: "b".repeat(64) },
    payment: null,
  });
  await user.click(
    screen.getByRole("button", { name: "Record GCash payment" }),
  );
  await screen.findByText(/The order changed/);
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(recordManualGcashPayment).not.toHaveBeenCalled();
});
it("saves and displays an optional reference without implying gateway verification", async () => {
  const { user } = await setup();
  await choosePaymentMethod(user, "GCASH_MANUAL");
  await user.type(
    screen.getByLabelText("Reference note / number (optional)"),
    "001234567890 - checked",
  );
  expect(
    screen.getByText(/No gateway verification is performed/),
  ).toBeVisible();
  await user.click(screen.getByRole("checkbox"));
  vi.mocked(recordManualGcashPayment).mockResolvedValue({
    ...gcashPaid,
    payment: { ...gcashPaid.payment, reference: "001234567890 - checked" },
  });
  await user.click(
    screen.getByRole("button", { name: "Record GCash payment" }),
  );
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Record GCash payment",
    }),
  );
  await screen.findByRole("heading", {
    name: "GCash payment recorded manually",
  });
  expect(screen.getByText("001234567890 - checked")).toBeVisible();
  expect(
    screen.getByText(/No gateway verification was performed/),
  ).toBeVisible();
  expect(recordManualGcashPayment).toHaveBeenCalledWith(
    order.shopId,
    order.id,
    expect.objectContaining({ reference: "001234567890 - checked" }),
    expect.any(AbortSignal),
  );
});
