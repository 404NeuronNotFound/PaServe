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
  await user.selectOptions(screen.getByLabelText("Payment method"), "OTHER");
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
  await user.selectOptions(screen.getByLabelText("Payment method"), "OTHER");
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "CARD_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "CARD_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "CARD_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "GCASH_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "GCASH_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "GCASH_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "GCASH_MANUAL",
  );
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
  await user.selectOptions(
    screen.getByLabelText("Payment method"),
    "GCASH_MANUAL",
  );
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
