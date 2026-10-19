import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuestTrackingShare } from "./GuestTrackingShare";

const id = "e47f6994-a303-4a7b-87b0-2386d5198828";
const token = `${Buffer.from(JSON.stringify({ v: 1, purpose: "order-tracking", shopId: "05bcdf9f-d1be-4669-a01c-0b657f5a2f8e", orderId: id, nonce: "75992537-5d60-4d22-8e1e-60a114644681", exp: Date.parse("2030-01-01T00:00:00Z") })).toString("base64url")}.${"a".repeat(43)}`;
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ trackingToken: token }),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("shows copy progress in place, blocks duplicate requests and unlocks after failure", async () => {
  let fail!: (error: Error) => void;
  fetchMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  render(<GuestTrackingShare shopSlug="cafe" orderId={id} orderNumber="ORD-000042" />);
  fireEvent.click(screen.getByText("Track on another device"));
  fireEvent.click(screen.getByRole("button", { name: "Copy private tracking link" }));
  const pending = screen.getByRole("button", { name: "Copying tracking link..." });
  expect(pending).toBeDisabled();
  expect(pending).toHaveAttribute("aria-busy", "true");
  fireEvent.click(pending);
  fireEvent.click(screen.getByRole("button", { name: "Show private tracking QR" }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => fail(new Error("offline")));
  expect(screen.getByRole("button", { name: "Copy private tracking link" })).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to share tracking");
});

it("copies the private fragment link and renders a distinct tracking QR only on request", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(
    <GuestTrackingShare
      shopSlug="cafe"
      orderId={id}
      orderNumber="ORD-000042"
    />,
  );
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByText("Track on another device"));
  expect(screen.getByText(/Anyone with this private link/)).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Copy private tracking link" }),
  );
  expect(copy).toHaveBeenCalledWith(
    `${window.location.origin}/menu/cafe/orders/${id}#tracking=${token}`,
  );
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    credentials: "include",
    cache: "no-store",
  });
  await user.click(
    screen.getByRole("button", { name: "Show private tracking QR" }),
  );
  expect(
    await screen.findByRole("img", {
      name: "Private tracking QR for ORD-000042",
    }),
  ).toHaveAttribute("src", expect.stringContaining("data:image/svg+xml"));
  expect(screen.queryByText(token)).not.toBeInTheDocument();
});

it.each(["unavailable", "cashier", "wrong-order", "expired"])(
  "does not share %s tracking access",
  async (kind) => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    if (kind === "unavailable")
      fetchMock.mockResolvedValue({ ok: false, status: 403 });
    else {
      const claims = JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString(),
      );
      if (kind === "cashier") claims.purpose = "order-receipt";
      if (kind === "wrong-order")
        claims.orderId = "75992537-5d60-4d22-8e1e-60a114644681";
      if (kind === "expired") claims.exp = 1;
      const invalid = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${"a".repeat(43)}`;
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ trackingToken: invalid }),
      });
    }
    render(
      <GuestTrackingShare
        shopSlug="cafe"
        orderId={id}
        orderNumber="ORD-000042"
      />,
    );
    await user.click(screen.getByText("Track on another device"));
    await user.click(
      screen.getByRole("button", { name: "Copy private tracking link" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to share tracking",
    );
    expect(copy).not.toHaveBeenCalled();
  },
);
