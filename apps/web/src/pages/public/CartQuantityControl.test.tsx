import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import { CartQuantityControl } from "./CartQuantityControl";
import { createCartPricePreview, useCart } from "../../features/cart/cart";
import { api } from "../../lib/api/client";
import { useFeedbackStore } from "../../app/stores/feedback";

vi.mock("../../lib/api/client", () => ({ api: { post: vi.fn() } }));
const quote: ProductSelectionQuoteResponse = {
  productId: "coffee", productName: "Coffee", currency: "PHP",
  basePrice: "1.00", unitPrice: "1.30", totalPrice: "2.60", quantity: 2,
  notes: "Less ice",
  variants: [{ id: "large", name: "Large", optionGroupId: "size", isDefault: false, priceAdjustment: "0.10" }],
  addOns: [{ id: "milk", name: "Milk", priceAdjustment: "0.20" }],
};
beforeEach(() => {
  vi.resetAllMocks();
  useCart.setState({ shops: {} });
  useFeedbackStore.getState().clear();
});
function setup(quantity = 2) {
  const configured = { ...quote, quantity, totalPrice: (quantity * 1.3).toFixed(2) };
  useCart.getState().add("cafe", configured, createCartPricePreview(configured));
  function Line() {
    const item = useCart((state) => state.shops.cafe[0]);
    return item ? <CartQuantityControl item={item} shopSlug="cafe" /> : null;
  }
  return render(<Line />);
}
it("requotes the saved configuration, retains line identity, and uses server prices", async () => {
  setup();
  useCart.getState().add("other", quote);
  const before = useCart.getState();
  vi.mocked(api.post).mockResolvedValue({ data: { ...quote, unitPrice: "1.40", totalPrice: "4.20", quantity: 3 } });
  await userEvent.setup().click(screen.getByRole("button", { name: "Increase quantity for Coffee" }));
  await waitFor(() => expect(useCart.getState().shops.cafe[0].quantity).toBe(3));
  expect(api.post).toHaveBeenCalledExactlyOnceWith("/menu/cafe/products/coffee/quote", {
    variantIds: ["large"], addOnIds: ["milk"], quantity: 3, notes: "Less ice",
  });
  expect(useCart.getState().shops.cafe[0]).toMatchObject({
    lineId: before.shops.cafe[0].lineId, notes: "Less ice",
    variantKey: before.shops.cafe[0].variantKey,
    variants: quote.variants, addOns: quote.addOns,
    unitPrice: "1.40", totalPrice: "4.20",
    pricePreview: { quantity: 3, unitPrice: "1.30", totalPrice: "3.90" },
  });
  expect(useCart.getState().shops.other).toBe(before.shops.other);
  await waitFor(() => expect(screen.getByRole("spinbutton")).toHaveFocus());
  expect(screen.queryByRole("button", { name: "Update quantity for Coffee" })).not.toBeInTheDocument();
});
it.each(["0", "100", "1.5", "-1", ""])("rejects invalid quantity %s without removing or changing the line", async (value) => {
  setup();
  const before = useCart.getState();
  const user = userEvent.setup();
  await user.clear(screen.getByRole("spinbutton"));
  if (value) await user.type(screen.getByRole("spinbutton"), value);
  expect(screen.getByRole("alert")).toHaveTextContent("whole number from 1 to 99");
  expect(screen.getByRole("button", { name: "Update quantity for Coffee" })).toBeDisabled();
  expect(useCart.getState()).toBe(before);
  expect(api.post).not.toHaveBeenCalled();
});
it.each([1, 99])("disables the stepper at quantity boundary %s", (quantity) => {
  setup(quantity);
  expect(screen.getByRole("button", { name: `${quantity === 1 ? "Decrease" : "Increase"} quantity for Coffee` })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Update quantity for Coffee" })).not.toBeInTheDocument();
});

it("previews a typed quantity locally without changing saved totals or submitting prices", async () => {
  setup();
  const before = useCart.getState();
  const user = userEvent.setup();
  await user.clear(screen.getByRole("spinbutton"));
  await user.type(screen.getByRole("spinbutton"), "3");
  expect(screen.getByRole("button", { name: "Update quantity for Coffee" })).toBeEnabled();
  expect(screen.getByText(/Estimated total for 3:/)).toHaveTextContent("₱3.90");
  expect(useCart.getState()).toBe(before);
  expect(api.post).not.toHaveBeenCalled();
  await user.clear(screen.getByRole("spinbutton"));
  await user.type(screen.getByRole("spinbutton"), "0");
  expect(screen.queryByText(/Estimated total for/)).not.toBeInTheDocument();
  await user.clear(screen.getByRole("spinbutton"));
  await user.type(screen.getByRole("spinbutton"), "2");
  expect(screen.queryByRole("button", { name: "Update quantity for Coffee" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Estimated total for/)).not.toBeInTheDocument();
  expect(useCart.getState()).toBe(before);
  expect(api.post).not.toHaveBeenCalled();
});
it("rolls back the displayed quantity after failure and allows retry", async () => {
  setup();
  const before = useCart.getState();
  const user = userEvent.setup();
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Unavailable"));
  await user.clear(screen.getByRole("spinbutton"));
  await user.type(screen.getByRole("spinbutton"), "99");
  await user.click(screen.getByRole("button", { name: "Update quantity for Coffee" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("saved item is unchanged");
  expect(screen.getByRole("spinbutton")).toHaveValue(2);
  expect(useCart.getState()).toBe(before);
  vi.mocked(api.post).mockResolvedValueOnce({ data: { ...quote, quantity: 99, totalPrice: "128.70" } });
  await user.clear(screen.getByRole("spinbutton"));
  await user.type(screen.getByRole("spinbutton"), "99");
  await user.click(screen.getByRole("button", { name: "Update quantity for Coffee" }));
  await waitFor(() => expect(useCart.getState().shops.cafe[0].quantity).toBe(99));
  expect(api.post).toHaveBeenCalledTimes(2);
});
it("restores a failed stepper change without leaving an unsaved draft", async () => {
  setup();
  const before = useCart.getState();
  vi.mocked(api.post).mockRejectedValueOnce(new Error("Unavailable"));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Increase quantity for Coffee" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("spinbutton")).toHaveValue(2);
  expect(screen.getByRole("alert")).toHaveTextContent("saved item is unchanged");
  expect(screen.queryByRole("button", { name: "Update quantity for Coffee" })).not.toBeInTheDocument();
  expect(useCart.getState()).toBe(before);
  expect(api.post).toHaveBeenCalledTimes(1);
});

it("offers a guarded retry for a failed quote without changing saved quantities", async () => {
  setup();
  vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true });
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Increase quantity for Coffee" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Check your connection");
  expect(useCart.getState().shops.cafe[0].quantity).toBe(2);
  let resolve!: (value: { data: ProductSelectionQuoteResponse }) => void;
  vi.mocked(api.post).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await user.dblClick(screen.getByRole("button", { name: "Retry quantity update" }));
  expect(screen.getByRole("button", { name: "Checking quantity…" })).toBeDisabled();
  await act(async () => resolve({ data: { ...quote, quantity: 3, totalPrice: "3.90" } }));
  await waitFor(() => expect(useCart.getState().shops.cafe[0].quantity).toBe(3));
  expect(api.post).toHaveBeenCalledTimes(2);
});

it("does not offer repeat quote retries for an unavailable product", async () => {
  setup();
  vi.mocked(api.post).mockRejectedValueOnce({ isAxiosError: true, response: { status: 404 } });
  await userEvent.click(screen.getByRole("button", { name: "Increase quantity for Coffee" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Return to the menu");
  expect(screen.queryByRole("button", { name: "Retry quantity update" })).not.toBeInTheDocument();
  expect(useCart.getState().shops.cafe[0].quantity).toBe(2);
});

it("shows quantity and estimated price immediately, then rolls back a rejected check", async () => {
  setup();
  const before = useCart.getState();
  let reject!: (reason: unknown) => void;
  vi.mocked(api.post).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
  const button = screen.getByRole("button", { name: "Increase quantity for Coffee" });
  await userEvent.dblClick(button);
  expect(screen.getByRole("spinbutton")).toHaveValue(3);
  expect(screen.getByText(/Estimated total for 3:/)).toHaveTextContent("₱3.90");
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(useCart.getState()).toBe(before);
  await act(async () => reject(new Error("Rejected")));
  expect(screen.getByRole("spinbutton")).toHaveValue(2);
  expect(screen.queryByText(/Estimated total for/)).not.toBeInTheDocument();
  expect(button).toBeEnabled();
  expect(useCart.getState()).toBe(before);
});
it.each(["remove", "close", "change"])("ignores a late response after %s", async (action) => {
  const view = setup();
  const original = useCart.getState().shops.cafe[0];
  let resolve!: (result: { data: ProductSelectionQuoteResponse }) => void;
  vi.mocked(api.post).mockReturnValue(new Promise((done) => { resolve = done; }));
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Increase quantity for Coffee" }));
  expect(screen.getByRole("spinbutton")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Increase quantity for Coffee" })).toBeDisabled();
  expect(original.quantity).toBe(2);
  if (action === "remove") act(() => useCart.getState().remove("cafe", original.lineId));
  if (action === "close") view.unmount();
  if (action === "change") act(() => {
    useCart.setState({ shops: { cafe: [{ ...original, notes: "Changed elsewhere" }] } });
  });
  const beforeResponse = useCart.getState();
  await act(async () => resolve({ data: { ...quote, quantity: 3, totalPrice: "3.90" } }));
  expect(useCart.getState()).toBe(beforeResponse);
  expect(api.post).toHaveBeenCalledTimes(1);
  if (action === "change") expect(screen.getByRole("alert")).toHaveTextContent("cart item changed");
});
