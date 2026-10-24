import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrderQrImagePicker } from "./OrderQrImagePicker";

it("reads a single dropped image through the existing selection action", () => {
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(
    <OrderQrImagePicker onSelect={onSelect} disabled={false} pending={false} />,
  );
  const file = new File(["qr"], "order.png", { type: "image/png" });
  fireEvent.drop(screen.getByRole("button", { name: "Choose QR image" }), {
    dataTransfer: { files: [file] },
  });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(file);
  expect(screen.getByRole("status")).toHaveTextContent("Selected: order.png");
});

it("rejects multiple, unsupported and oversized drops before decoding", () => {
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(
    <OrderQrImagePicker onSelect={onSelect} disabled={false} pending={false} />,
  );
  const zone = screen.getByRole("button", { name: "Choose QR image" });
  const file = new File(["qr"], "order.png", { type: "image/png" });
  fireEvent.drop(zone, { dataTransfer: { files: [file, file] } });
  expect(screen.getByRole("alert")).toHaveTextContent("Choose one QR image");
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [new File(["x"], "image.svg", { type: "image/svg+xml" })],
    },
  });
  expect(screen.getByRole("alert")).toHaveTextContent("up to 10 MB");
  const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
    type: "image/png",
  });
  fireEvent.drop(zone, { dataTransfer: { files: [large] } });
  expect(onSelect).not.toHaveBeenCalled();
});

it("prevents selection while pending or access is unavailable", () => {
  const onSelect = vi.fn();
  const { rerender } = render(
    <OrderQrImagePicker onSelect={onSelect} disabled={false} pending />,
  );
  const zone = screen.getByRole("button", { name: "Choose QR image" });
  expect(zone).toBeDisabled();
  fireEvent.drop(zone, {
    dataTransfer: {
      files: [new File(["qr"], "order.png", { type: "image/png" })],
    },
  });
  expect(onSelect).not.toHaveBeenCalled();
  rerender(<OrderQrImagePicker onSelect={onSelect} disabled pending={false} />);
  expect(zone).toBeDisabled();
});

it("allows choosing the same file again and recovers from an invalid selection", async () => {
  const onSelect = vi.fn().mockResolvedValue(undefined);
  render(
    <OrderQrImagePicker onSelect={onSelect} disabled={false} pending={false} />,
  );
  const input = screen.getByLabelText("Choose an order QR image");
  fireEvent.drop(screen.getByRole("button", { name: "Choose QR image" }), {
    dataTransfer: { files: [] },
  });
  const file = new File(["qr"], "order.png", { type: "image/png" });
  const user = userEvent.setup();
  await user.upload(input, file);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.upload(input, file);
  expect(onSelect).toHaveBeenCalledTimes(2);
});
