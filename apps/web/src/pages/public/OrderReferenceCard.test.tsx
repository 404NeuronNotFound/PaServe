import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderReferenceCard } from "./OrderReferenceCard";
import { createCustomerQrImage } from "../../features/cart/customer-order-qr";
vi.mock("../../features/cart/customer-order-qr", () => ({
  createCustomerQrImage: vi.fn(),
}));
const credential = {
  qrToken: "server-issued-token",
  orderNumber: "ORD-000042",
  expiresAt: Date.now() + 60000,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createCustomerQrImage).mockResolvedValue(
    "data:image/svg+xml,local-qr",
  );
});
afterEach(() => {
  vi.useRealTimers();
});
it("starts on QR, flips by keyboard, preserves focus and hides inactive controls", async () => {
  const user = userEvent.setup();
  render(
    <OrderReferenceCard
      credential={credential}
      orderNumber={credential.orderNumber}
    />,
  );
  await screen.findByRole("img", { name: "Order QR for ORD-000042" });
  expect(
    screen.queryByRole("button", { name: "Copy order number" }),
  ).not.toBeInTheDocument();
  const flip = screen.getByRole("button", { name: "Show order number" });
  flip.focus();
  await user.keyboard("{Enter}");
  expect(
    screen.getByRole("region", { name: "Order number" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Copy order number" }),
  ).toBeEnabled();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(flip).toHaveFocus();
  expect(
    screen.getByRole("region", { name: "Order number" }).parentElement,
  ).not.toHaveAttribute("inert");
  expect(
    screen.getByRole("region", { name: "Your order QR", hidden: true }),
  ).toBeInTheDocument();
});
it("returns to the same QR without regenerating it", async () => {
  const user = userEvent.setup();
  render(
    <OrderReferenceCard
      credential={credential}
      orderNumber={credential.orderNumber}
    />,
  );
  const image = await screen.findByRole("img");
  await user.click(screen.getByRole("button", { name: "Show order number" }));
  await user.click(screen.getByRole("button", { name: "Show QR code" }));
  expect(screen.getByRole("img")).toBe(image);
  expect(createCustomerQrImage).toHaveBeenCalledExactlyOnceWith(
    credential.qrToken,
  );
  expect(
    screen.getByText(credential.orderNumber).closest("[aria-hidden]"),
  ).toHaveAttribute("inert");
});
it("keeps number fallback reachable without a QR credential", async () => {
  const user = userEvent.setup();
  render(
    <OrderReferenceCard
      credential={null}
      orderNumber={credential.orderNumber}
    />,
  );
  expect(screen.getByText(/unavailable in this session/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show order number" }));
  expect(
    screen.getByRole("region", { name: "Order number" }),
  ).toHaveTextContent(credential.orderNumber);
  expect(createCustomerQrImage).not.toHaveBeenCalled();
});
it("expires the QR while its face is hidden instead of reviving it on flip", async () => {
  vi.useFakeTimers();
  render(
    <OrderReferenceCard
      credential={{ ...credential, expiresAt: Date.now() + 1000 }}
      orderNumber={credential.orderNumber}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    screen.getByRole("button", { name: "Show order number" }).click();
  });
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  act(() => {
    screen.getByRole("button", { name: "Show QR code" }).click();
  });
  expect(screen.getByText(/has expired/)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
