import { beforeEach, afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError, AxiosHeaders } from "axios";
import type { VerifyOrderQrResponse } from "@paserve/contracts";
import { CashierOrderDecision } from "./CashierOrderDecision";
import {
  verifyScannedOrder,
  lookupOrderNumber,
} from "../../features/cashier/order-qr";
import { decideOrder } from "../../features/cashier/order-decision";
import { cashierLine } from "../../test/cashier-fixtures";
import { subscribeOrderStream } from "../../features/orders/new-order-events";
vi.mock("../../features/orders/new-order-events", () => ({
  subscribeOrderStream: vi.fn(() => vi.fn()),
}));
import {
  reviewCashPayment,
  createPayment,
} from "../../features/cashier/cash-payment";
vi.mock("../../features/cashier/cash-payment", async (original) => ({
  ...(await original<typeof import("../../features/cashier/cash-payment")>()),
  reviewCashPayment: vi.fn(),
  createPayment: vi.fn(),
}));

vi.mock("../../features/cashier/order-qr", () => ({
  verifyScannedOrder: vi.fn(),
  lookupOrderNumber: vi.fn(),
}));
vi.mock("../../features/cashier/order-decision", () => ({
  decideOrder: vi.fn(),
}));
const order: VerifyOrderQrResponse["order"] = {
  id: "order-a",
  shopId: "shop-a",
  orderNumber: "ORD-000042",
  mode: "TAKEOUT",
  tableNumber: null,
  currency: "PHP",
  totalPrice: "135.50",
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  items: [cashierLine],
  reviewVersion: "a".repeat(64),
};
const decision = {
  id: order.id,
  shopId: order.shopId,
  orderNumber: order.orderNumber,
  status: "REJECTED" as const,
  paymentStatus: "UNPAID" as const,
  decidedBy: "cashier",
  decidedAt: "2026-10-13T00:00:00.000Z",
  rejectionReason: null,
};

it("shows the paid receipt when another cashier confirms the open order", async () => {
  const paid = {
    order: { ...order, status: "CONFIRMED", paymentStatus: "PAID" },
    payment: {
      method: "CASH" as const,
      requestId: "58bb31e6-9c13-4c07-9e04-fbb29b0584ab",
      amountReceived: "200.00",
      changeDue: "64.50",
      paidAt: "2026-10-15T01:00:00Z",
      paidBy: "other-cashier",
    },
  };
  vi.mocked(reviewCashPayment).mockResolvedValue(paid);
  render(<CashierOrderDecision order={order} qrToken="" onNext={vi.fn()} />);
  vi.mocked(lookupOrderNumber).mockRejectedValue(
    new Error("Already processed"),
  );
  act(() =>
    vi
      .mocked(subscribeOrderStream)
      .mock.calls[0][4]("order_confirmed", {
        shopId: order.shopId,
        orderId: order.id,
      }),
  );
  await screen.findByRole("heading", { name: "Cash payment recorded" });
  expect(
    screen.getByText(/already has a saved cash payment/),
  ).toBeInTheDocument();
  expect(createPayment).not.toHaveBeenCalled();
});
const modal = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const close = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(verifyScannedOrder).mockResolvedValue(order);
  vi.mocked(lookupOrderNumber).mockResolvedValue(order);
  vi.mocked(decideOrder).mockResolvedValue(decision);
  vi.mocked(reviewCashPayment).mockResolvedValue({
    order,
    payment: null,
  });
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
  if (modal)
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", modal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});
function setup() {
  const next = vi.fn();
  return {
    ...render(
      <CashierOrderDecision
        order={order}
        qrToken="secret-token"
        onNext={next}
      />,
    ),
    user: userEvent.setup(),
    next,
  };
}
async function open(
  action: "Confirm order" | "Reject order",
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole("button", { name: action }));
  return await screen.findByRole("dialog");
}
it.each(["CASH", "GCASH_MANUAL", "CARD_MANUAL", "OTHER"])(
  "confirms and pays %s together after reviewing payment",
  async (method) => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
    await screen.findByLabelText("Payment method");
    await user.selectOptions(screen.getByLabelText("Payment method"), method);
    if (method === "CASH")
      await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
    else {
      if (method === "OTHER")
        await user.type(
          screen.getByLabelText("Payment method description"),
          "Shop voucher",
        );
      await user.click(screen.getByRole("checkbox"));
    }
    vi.mocked(createPayment).mockResolvedValue({
      order: { ...order, status: "CONFIRMED", paymentStatus: "PAID" },
      payment: {
        method: method as "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER",
        requestId: "58bb31e6-9c13-4c07-9e04-fbb29b0584ab",
        amountReceived: method === "CASH" ? "200.00" : "135.50",
        changeDue: method === "CASH" ? "64.50" : "0.00",
        paidBy: "cashier",
        paidAt: decision.decidedAt,
        ...(method === "OTHER" ? { description: "Shop voucher" } : {}),
      },
    });
    await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
    const dialog = await screen.findByRole("dialog");
    expect(createPayment).not.toHaveBeenCalled();
    expect(decideOrder).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Confirm and pay" }),
    );
    await screen.findByText("ORD-000042 is paid.");
    expect(createPayment).toHaveBeenCalledWith(
      order.shopId,
      order.id,
      expect.objectContaining({
        method,
        qrToken: "secret-token",
        reviewVersion: order.reviewVersion,
      }),
      expect.any(AbortSignal),
    );
    expect(decideOrder).not.toHaveBeenCalled();
  },
);
it("uses the explicit number reference for confirm-and-pay fallback", async () => {
  const user = userEvent.setup();
  render(<CashierOrderDecision order={order} qrToken="" onNext={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
  await screen.findByLabelText("Amount received (PHP)");
  expect(lookupOrderNumber).toHaveBeenCalled();
  expect(verifyScannedOrder).not.toHaveBeenCalled();
  expect(decideOrder).not.toHaveBeenCalled();
});
it("requires a new review after changed details before opening payment", async () => {
  const updated = {
    ...order,
    reviewVersion: "b".repeat(64),
    items: [{ ...cashierLine, notes: "Updated note" }],
  };
  vi.mocked(verifyScannedOrder).mockResolvedValue(updated);
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
  await screen.findByText(/This order changed/);
  expect(screen.queryByLabelText("Payment method")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
  await screen.findByLabelText("Payment method");
  expect(createPayment).not.toHaveBeenCalled();
});
it("locks uncertain combined saves until refresh reveals the paid receipt", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
  await screen.findByLabelText("Amount received (PHP)");
  await user.type(screen.getByLabelText("Amount received (PHP)"), "200");
  await user.click(screen.getByRole("button", { name: "Confirm and pay" }));
  vi.mocked(createPayment).mockRejectedValue(new Error("Connection lost."));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Confirm and pay",
    }),
  );
  await screen.findByText(/payment result is unconfirmed/);
  expect(
    screen.getByRole("button", { name: "Confirm and pay" }),
  ).toBeDisabled();
  vi.mocked(verifyScannedOrder).mockRejectedValue(new Error("Processed QR."));
  vi.mocked(reviewCashPayment).mockResolvedValue({
    order: { ...order, status: "CONFIRMED", paymentStatus: "PAID" },
    payment: {
      method: "CASH",
      requestId: "58bb31e6-9c13-4c07-9e04-fbb29b0584ab",
      amountReceived: "200.00",
      changeDue: "64.50",
      paidBy: "cashier",
      paidAt: decision.decidedAt,
    },
  });
  await user.click(screen.getByRole("button", { name: "Refresh payment" }));
  await screen.findByRole("heading", { name: "Cash payment recorded" });
  expect(createPayment).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByText("Return the change to the customer."),
  ).not.toBeInTheDocument();
});
it("rejects with the entered reason and shows the saved reason as text", async () => {
  vi.mocked(decideOrder).mockResolvedValue({
    ...decision,
    status: "REJECTED",
    rejectionReason: "<b>Wrong order</b>",
  });
  const { user, container } = setup();
  await user.type(
    screen.getByLabelText("Rejection reason (optional)"),
    "<b>Wrong order</b>",
  );
  const dialog = await open("Reject order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Reject order" }),
  );
  await screen.findByRole("heading", { name: "Order rejected" });
  expect(decideOrder).toHaveBeenCalledWith(
    order,
    "secret-token",
    "reject",
    "<b>Wrong order</b>",
    expect.any(AbortSignal),
  );
  expect(container.querySelector("b")).toBeNull();
});
it("aborts an outstanding review check when leaving", async () => {
  vi.mocked(verifyScannedOrder).mockImplementation(
    () => new Promise(() => undefined),
  );
  const { user, unmount } = setup();
  await user.click(screen.getByRole("button", { name: "Refresh order" }));
  const signal = vi.mocked(verifyScannedOrder).mock.calls[0][2];
  unmount();
  expect(signal.aborted).toBe(true);
});

it("displays changed saved details and requires another review before approval", async () => {
  const updated = {
    ...order,
    reviewVersion: "b".repeat(64),
    items: [{ ...cashierLine, notes: "Updated note" }],
  };
  vi.mocked(verifyScannedOrder).mockResolvedValue(updated);
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Reject order" }));
  expect(await screen.findByText("Updated note")).toBeInTheDocument();
  expect(screen.getByText(/This order changed/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(decideOrder).not.toHaveBeenCalled();
  const dialog = await open("Reject order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Reject order" }),
  );
  expect(decideOrder).toHaveBeenCalledWith(
    updated,
    "secret-token",
    "reject",
    "",
    expect.any(AbortSignal),
  );
});

it.each([401, 403, 409])(
  "blocks decisions when revalidation fails (%s), then recovers after refresh",
  async (status) => {
    const error = new AxiosError("Denied");
    error.response = {
      status,
      statusText: "Denied",
      config: { headers: new AxiosHeaders() },
      headers: {},
      data: { message: "This order is unavailable." },
    };
    vi.mocked(verifyScannedOrder).mockRejectedValueOnce(error);
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Reject order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This order is unavailable.",
    );
    expect(screen.getByRole("button", { name: "Reject order" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject order" })).toBeDisabled();
    expect(decideOrder).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Refresh order" }));
    expect(screen.getByRole("button", { name: "Reject order" })).toBeEnabled();
  },
);

it("locks decisions on an uncertain save rather than automatically retrying", async () => {
  vi.mocked(decideOrder).mockRejectedValueOnce(new Error("Network lost"));
  const { user } = setup();
  const dialog = await open("Reject order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Reject order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The decision result could not be confirmed.",
  );
  expect(screen.getByRole("button", { name: "Reject order" })).toBeDisabled();
  expect(decideOrder).toHaveBeenCalledTimes(1);
});

it("blocks conflicting controls and duplicate approval while saving", async () => {
  vi.mocked(decideOrder).mockImplementation(() => new Promise(() => undefined));
  const { user } = setup();
  const dialog = await open("Reject order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Reject order" }),
  );
  expect(
    within(dialog).getByRole("button", { name: "Keep reviewing" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Scan another order" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh order" })).toBeDisabled();
  expect(decideOrder).toHaveBeenCalledTimes(1);
});

it("aborts an outstanding review check when leaving", async () => {
  vi.mocked(verifyScannedOrder).mockImplementation(
    () => new Promise(() => undefined),
  );
  const { user, unmount } = setup();
  await user.click(screen.getByRole("button", { name: "Refresh order" }));
  const signal = vi.mocked(verifyScannedOrder).mock.calls[0][2];
  unmount();
  expect(signal.aborted).toBe(true);
});

it("keeps actions blocked if a refreshed order has an ineligible state", async () => {
  vi.mocked(verifyScannedOrder).mockResolvedValue({
    ...order,
    status: "CONFIRMED",
  });
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Reject order" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no longer eligible",
  );
  expect(decideOrder).not.toHaveBeenCalled();
});

it("fails closed with a useful message for a refresh error without a JSON body", async () => {
  const error = new AxiosError("Proxy failed");
  error.response = {
    status: 502,
    statusText: "Bad gateway",
    config: { headers: new AxiosHeaders() },
    headers: {},
    data: null,
  };
  vi.mocked(verifyScannedOrder).mockRejectedValueOnce(error);
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Refresh order" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Unable to check the current order",
  );
  expect(screen.getByRole("button", { name: "Reject order" })).toBeDisabled();
});

it("ignores a late successful decision after unmount", async () => {
  let resolve!: (saved: typeof decision) => void;
  vi.mocked(decideOrder).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { user, unmount } = setup();
  const dialog = await open("Reject order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Reject order" }),
  );
  const signal = vi.mocked(decideOrder).mock.calls[0][4];
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(decision);
  });
  await waitFor(() =>
    expect(screen.queryByText(/has been rejected/)).not.toBeInTheDocument(),
  );
});
