import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CustomerOrderQr } from "./CustomerOrderQr";
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
    "data:image/svg+xml,encoded-local-image",
  );
});
afterEach(() => {
  vi.useRealTimers();
});
it("shows the server token as a labelled local QR image without displaying token text", async () => {
  render(<CustomerOrderQr credential={credential} />);
  const image = await screen.findByRole("img", {
    name: "Order QR for ORD-000042",
  });
  expect(image).toHaveAttribute(
    "src",
    "data:image/svg+xml,encoded-local-image",
  );
  expect(createCustomerQrImage).toHaveBeenCalledWith(credential.qrToken);
  expect(screen.queryByText(credential.qrToken)).not.toBeInTheDocument();
});
it("shows useful fallback guidance without inventing a QR for a missing token", () => {
  render(<CustomerOrderQr credential={null} />);
  expect(screen.getByText(/unavailable in this session/)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(createCustomerQrImage).not.toHaveBeenCalled();
});
it("does not generate a QR for an already expired credential", () => {
  render(
    <CustomerOrderQr
      credential={{ ...credential, expiresAt: Date.now() - 1 }}
    />,
  );
  expect(screen.getByText(/has expired/)).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(createCustomerQrImage).not.toHaveBeenCalled();
});
it("handles rendering failure with a working local retry", async () => {
  vi.mocked(createCustomerQrImage).mockRejectedValueOnce(
    new Error("Encoder failed"),
  );
  const user = userEvent.setup();
  render(<CustomerOrderQr credential={credential} />);
  await user.click(
    await screen.findByRole("button", { name: "Retry QR display" }),
  );
  expect(await screen.findByRole("img")).toBeInTheDocument();
  expect(createCustomerQrImage).toHaveBeenCalledTimes(2);
});
it("removes the QR at expiry while the receipt stays open", async () => {
  vi.useFakeTimers();
  const view = render(
    <CustomerOrderQr
      credential={{ ...credential, expiresAt: Date.now() + 1000 }}
    />,
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(screen.getByRole("img")).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByText(/has expired/)).toBeInTheDocument();
  view.unmount();
});
it("does not revive an image when a previous receipt finishes rendering late", async () => {
  let done!: (image: string) => void;
  vi.mocked(createCustomerQrImage).mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const view = render(<CustomerOrderQr credential={credential} />);
  view.rerender(<CustomerOrderQr credential={null} />);
  await act(async () => {
    done("data:image/svg+xml,old-image");
  });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
