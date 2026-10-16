import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import { OrderQrScanner } from "./OrderQrScanner";
import {
  verifyScannedOrder,
  lookupOrderNumber,
} from "../../features/cashier/order-qr";
import { readQrImage } from "../../features/cashier/qr-decoder";
import { cashierLine } from "../../test/cashier-fixtures";
import {
  lookupCashPayment,
  reviewCashPayment,
} from "../../features/cashier/cash-payment";
vi.mock("../../features/cashier/cash-payment", async (original) => ({
  ...(await original<typeof import("../../features/cashier/cash-payment")>()),
  lookupCashPayment: vi.fn(),
  reviewCashPayment: vi.fn(),
}));

vi.mock("../../features/cashier/order-qr", async (original) => ({
  ...(await original<typeof import("../../features/cashier/order-qr")>()),
  verifyScannedOrder: vi.fn(),
  lookupOrderNumber: vi.fn(),
}));
vi.mock("../../features/cashier/qr-decoder", () => ({ readQrImage: vi.fn() }));
const stop = vi.fn();
const start = vi.fn();
let cameraUnavailable =
  "Camera scanning is unsupported. Use the options below.";
let scan!: (raw: string) => boolean;
vi.mock("../../features/cashier/useQrCamera", () => ({
  cameraUnavailableReason: () => cameraUnavailable,
  useQrCamera: (callback: typeof scan) => {
    scan = callback;
    return {
      videoRef: { current: null },
      phase: "idle",
      error: "",
      cameras: [],
      deviceId: "",
      start,
      stop,
    };
  },
}));
const shopId = "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e";
const orderId = "e47f6994-a303-4a7b-87b0-2386d5198828";
const token = (shop = shopId) =>
  `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-receipt", shopId: shop, orderId, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: 1792454400000 })).toString("base64url")}.${"a".repeat(43)}`;
const order = {
  id: orderId,
  shopId,
  orderNumber: "ORD-000042",
  mode: "TAKEOUT" as const,
  status: "PENDING_CONFIRMATION",
  paymentStatus: "UNPAID",
  reviewVersion: "a".repeat(64),
  currency: "PHP",
  totalPrice: "135.50",
  tableNumber: null,
  items: [cashierLine],
};
beforeEach(() => {
  vi.resetAllMocks();
  cameraUnavailable = "Camera scanning is unsupported. Use the options below.";
  vi.mocked(verifyScannedOrder).mockResolvedValue(order);
  vi.mocked(lookupOrderNumber).mockResolvedValue(order);
  vi.mocked(lookupCashPayment).mockResolvedValue({
    order: { ...order, status: "CONFIRMED" },
    payment: null,
  });
  vi.mocked(reviewCashPayment).mockResolvedValue({
    order: { ...order, status: "CONFIRMED" },
    payment: null,
  });
});
afterEach(() => vi.restoreAllMocks());
function setup(initialOrderNumber = "") {
  const view = render(
    <MemoryRouter>
      <OrderQrScanner shopId={shopId} initialOrderNumber={initialOrderNumber} />
    </MemoryRouter>,
  );
  return { ...view, user: userEvent.setup() };
}
it("prefills an owner handoff without looking up or processing the order automatically", async () => {
  const { user } = setup("ORD-000042");
  expect(screen.getByLabelText("Find by order number")).toHaveValue("ORD-000042");
  expect(lookupOrderNumber).not.toHaveBeenCalled();
  expect(lookupCashPayment).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Find order" }));
  await waitFor(() => expect(lookupOrderNumber).toHaveBeenCalledWith(shopId, "ORD-000042", expect.any(AbortSignal)));
});
function failure(
  status: number,
  code: string,
  message = "This order QR is invalid or expired.",
) {
  const error = new AxiosError("Denied");
  error.response = {
    status,
    statusText: "Denied",
    config: { headers: new AxiosHeaders() },
    headers: {},
    data: { code, message },
  };
  return error;
}
it("does not request a camera automatically and provides fallback controls", () => {
  setup();
  expect(start).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Start camera" })).toBeDisabled();
  expect(screen.getByLabelText("Choose an order QR image")).toBeEnabled();
  expect(screen.getByLabelText("Paste order QR contents")).toBeEnabled();
});
it("keeps advanced fallback options compact on supported devices and lets the cashier expand them", async () => {
  cameraUnavailable = "";
  const { user } = setup();
  const disclosure = screen
    .getByText("Other scanning options")
    .closest("details");
  expect(disclosure).not.toHaveAttribute("open");
  expect(screen.getByLabelText("Find by order number")).toBeVisible();
  await user.click(screen.getByText("Other scanning options"));
  expect(disclosure).toHaveAttribute("open");
  expect(screen.getByLabelText("Paste order QR contents")).toBeVisible();
  expect(start).not.toHaveBeenCalled();
});
it("verifies pasted QR contents, clears the credential, and shows only saved server details", async () => {
  const { user } = setup();
  await user.click(screen.getByLabelText("Paste order QR contents"));
  await user.paste(token());
  await user.click(screen.getByRole("button", { name: "Verify pasted QR" }));
  expect(await screen.findByText("ORD-000042")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Review order" })).toHaveFocus();
  expect(
    screen.queryByLabelText("Paste order QR contents"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Choose an order QR image"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Start camera" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(
      /Verification does not confirm this order or record payment\./,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText(token())).not.toBeInTheDocument();
  expect(stop).toHaveBeenCalled();
  expect(verifyScannedOrder).toHaveBeenCalledWith(
    shopId,
    token(),
    expect.any(AbortSignal),
  );
});
it.each(["T12", "ORD-000042", token("55b18d73-f2fb-4fe6-bb1c-30cf385c3b24")])(
  "does not verify a table, number, or foreign-shop QR",
  async (raw) => {
    const { user } = setup();
    await user.click(screen.getByLabelText("Paste order QR contents"));
    await user.paste(raw);
    await user.click(screen.getByRole("button", { name: "Verify pasted QR" }));
    expect(verifyScannedOrder).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  },
);
it("reads an uploaded QR locally before verification", async () => {
  vi.mocked(readQrImage).mockResolvedValue(token());
  const { user } = setup();
  const file = new File(["qr"], "order.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("Choose an order QR image"), file);
  expect(readQrImage).toHaveBeenCalledWith(file);
  expect(await screen.findByText("ORD-000042")).toBeInTheDocument();
});
it("keeps fallback actions available after image reading fails", async () => {
  vi.mocked(readQrImage).mockRejectedValue(new Error("No QR code was found."));
  const { user } = setup();
  await user.upload(
    screen.getByLabelText("Choose an order QR image"),
    new File(["qr"], "order.png", { type: "image/png" }),
  );
  expect(await screen.findByText("No QR code was found.")).toBeInTheDocument();
  expect(verifyScannedOrder).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Paste order QR contents")).toBeEnabled();
});
it("suppresses duplicate camera scans while verification is pending", async () => {
  vi.mocked(verifyScannedOrder).mockImplementation(
    () => new Promise(() => undefined),
  );
  setup();
  act(() => {
    scan(token());
    scan(token());
    scan(token());
  });
  expect(verifyScannedOrder).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Choose an order QR image")).toBeDisabled();
});
it("fails closed for an invalid token without displaying an order", async () => {
  vi.mocked(verifyScannedOrder).mockRejectedValue(
    failure(403, "ORDER_TOKEN_INVALID"),
  );
  setup();
  act(() => {
    scan(token());
  });
  expect(
    await screen.findByText("This order QR is invalid or expired."),
  ).toBeInTheDocument();
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Paste order QR contents")).toBeEnabled();
});
it("shows an ineligible-order error and permits scanning another order", async () => {
  const message =
    "This order is no longer awaiting cashier confirmation. Check its current status with the shop.";
  vi.mocked(verifyScannedOrder).mockRejectedValue(
    failure(409, "ORDER_NOT_PENDING_CONFIRMATION", message),
  );
  setup();
  act(() => {
    scan(token());
  });
  expect(await screen.findByText(message)).toBeInTheDocument();
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Paste order QR contents")).toBeEnabled();
  expect(
    screen.queryByRole("link", { name: "Sign in again" }),
  ).not.toBeInTheDocument();
});
it.each([401, 403])(
  "blocks scanner actions after session/access failure (%s)",
  async (status) => {
    vi.mocked(verifyScannedOrder).mockRejectedValue(
      failure(status, "ACCESS_DENIED"),
    );
    setup();
    act(() => {
      scan(token());
    });
    expect(
      await screen.findByRole("link", {
        name: status === 401 ? "Sign in again" : "Choose another shop",
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Paste order QR contents")).toBeDisabled();
    expect(screen.getByLabelText("Choose an order QR image")).toBeDisabled();
  },
);
it("aborts pending verification when leaving the page", async () => {
  vi.mocked(verifyScannedOrder).mockImplementation(
    () => new Promise(() => undefined),
  );
  const view = setup();
  act(() => {
    scan(token());
  });
  const signal = vi.mocked(verifyScannedOrder).mock.calls[0][2];
  view.unmount();
  expect(signal.aborted).toBe(true);
});
it("allows another order after a successful scan", async () => {
  const { user } = setup();
  act(() => {
    scan(token());
  });
  await screen.findByText("ORD-000042");
  await user.click(screen.getByRole("button", { name: "Scan another order" }));
  expect(screen.queryByText("ORD-000042")).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Scan customer order QR" }),
  ).toHaveFocus();
  expect(screen.getByLabelText("Paste order QR contents")).toHaveValue("");
  expect(start).not.toHaveBeenCalled();
  act(() => {
    scan(token());
  });
  await waitFor(() => expect(verifyScannedOrder).toHaveBeenCalledTimes(2));
});
it("loads a receipt by number through a separate fallback, without calling QR verification", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("Find by order number"), "ORD-000042");
  await user.click(screen.getByRole("button", { name: "Find order" }));
  expect(await screen.findByText("Order loaded by number")).toBeInTheDocument();
  expect(lookupOrderNumber).toHaveBeenCalledWith(
    shopId,
    "ORD-000042",
    expect.any(AbortSignal),
  );
  expect(verifyScannedOrder).not.toHaveBeenCalled();
  expect(stop).toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Scan another order" }));
  expect(screen.getByLabelText("Find by order number")).toHaveValue("");
});
it("reopens a confirmed order by number for cash collection", async () => {
  vi.mocked(lookupOrderNumber).mockRejectedValue(
    failure(409, "ORDER_NOT_PENDING_CONFIRMATION"),
  );
  const { user } = setup();
  await user.type(screen.getByLabelText("Find by order number"), "ORD-000042");
  await user.click(screen.getByRole("button", { name: "Find order" }));
  await screen.findByLabelText("Amount received (PHP)");
  expect(lookupCashPayment).toHaveBeenCalledWith(
    shopId,
    "ORD-000042",
    expect.any(AbortSignal),
  );
  expect(verifyScannedOrder).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Scan another order" }));
  expect(screen.getByLabelText("Find by order number")).toHaveValue("");
});
it.each([401, 403, 500])(
  "handles a response without a JSON error body (%s)",
  async (status) => {
    const error = failure(status, "ACCESS_DENIED");
    error.response!.data = null;
    vi.mocked(verifyScannedOrder).mockRejectedValue(error);
    setup();
    act(() => {
      scan(token());
    });
    if (status === 500) {
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Unable to verify the order",
      );
      expect(screen.getByLabelText("Paste order QR contents")).toBeEnabled();
    } else {
      expect(
        await screen.findByRole("link", {
          name: status === 401 ? "Sign in again" : "Choose another shop",
        }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Paste order QR contents")).toBeDisabled();
    }
  },
);
it("keeps the loaded order in review when a late camera callback arrives", async () => {
  setup();
  act(() => {
    scan(token());
  });
  await screen.findByRole("heading", { name: "Review order" });
  act(() => {
    scan(token());
  });
  expect(verifyScannedOrder).toHaveBeenCalledTimes(1);
  expect(screen.getByText("ORD-000042")).toBeInTheDocument();
});
