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
import { verifyScannedOrder } from "../../features/cashier/order-qr";
import { decideOrder } from "../../features/cashier/order-decision";
import { cashierLine } from "../../test/cashier-fixtures";

vi.mock("../../features/cashier/order-qr", () => ({
  verifyScannedOrder: vi.fn(),
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
  status: "CONFIRMED" as const,
  paymentStatus: "UNPAID" as const,
  decidedBy: "cashier",
  decidedAt: "2026-10-13T00:00:00.000Z",
  rejectionReason: null,
};
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
  vi.mocked(decideOrder).mockResolvedValue(decision);
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
it("revalidates before asking for a decision and keeps Cancel focused", async () => {
  const { user } = setup();
  const dialog = await open("Confirm order", user);
  expect(verifyScannedOrder).toHaveBeenCalledWith(
    order.shopId,
    "secret-token",
    expect.any(AbortSignal),
  );
  expect(
    within(dialog).getByRole("button", { name: "Keep reviewing" }),
  ).toHaveFocus();
  expect(decideOrder).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", { name: "Keep reviewing" }),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm order" })).toHaveFocus();
});
it("confirms only after explicit dialog approval and shows unpaid server outcome", async () => {
  const { user } = setup();
  const dialog = await open("Confirm order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm order" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Order confirmed" }),
  ).toHaveFocus();
  expect(decideOrder).toHaveBeenCalledWith(
    order,
    "secret-token",
    "confirm",
    "",
    expect.any(AbortSignal),
  );
  expect(
    screen.getByText(
      "Payment status: unpaid. This decision did not record payment.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Confirm order" }),
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
it("displays changed saved details and requires another review before approval", async () => {
  const updated = {
    ...order,
    reviewVersion: "b".repeat(64),
    items: [{ ...cashierLine, notes: "Updated note" }],
  };
  vi.mocked(verifyScannedOrder).mockResolvedValue(updated);
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Confirm order" }));
  expect(await screen.findByText("Updated note")).toBeInTheDocument();
  expect(screen.getByText(/This order changed/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(decideOrder).not.toHaveBeenCalled();
  const dialog = await open("Confirm order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm order" }),
  );
  expect(decideOrder).toHaveBeenCalledWith(
    updated,
    "secret-token",
    "confirm",
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
    await user.click(screen.getByRole("button", { name: "Confirm order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This order is unavailable.",
    );
    expect(
      screen.getByRole("button", { name: "Confirm order" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject order" })).toBeDisabled();
    expect(decideOrder).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Refresh order" }));
    expect(screen.getByRole("button", { name: "Confirm order" })).toBeEnabled();
  },
);
it("locks decisions on an uncertain save rather than automatically retrying", async () => {
  vi.mocked(decideOrder).mockRejectedValueOnce(new Error("Network lost"));
  const { user } = setup();
  const dialog = await open("Confirm order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm order" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The decision result could not be confirmed.",
  );
  expect(screen.getByRole("button", { name: "Confirm order" })).toBeDisabled();
  expect(decideOrder).toHaveBeenCalledTimes(1);
});
it("blocks conflicting controls and duplicate approval while saving", async () => {
  vi.mocked(decideOrder).mockImplementation(() => new Promise(() => undefined));
  const { user } = setup();
  const dialog = await open("Confirm order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm order" }),
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
  await user.click(screen.getByRole("button", { name: "Confirm order" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no longer eligible",
  );
  expect(decideOrder).not.toHaveBeenCalled();
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
  const dialog = await open("Confirm order", user);
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm order" }),
  );
  const signal = vi.mocked(decideOrder).mock.calls[0][4];
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(decision);
  });
  await waitFor(() =>
    expect(screen.queryByText(/has been confirmed/)).not.toBeInTheDocument(),
  );
});
