import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it } from "vitest";
import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
import { CartNotesEditor } from "./CartNotesEditor";
import { cartCheckoutLines, createCartPricePreview, useCart } from "../../features/cart/cart";
import { useFeedbackStore } from "../../app/stores/feedback";
import { MemoryRouter } from "react-router-dom";
import { CustomerCart } from "./CustomerCart";

const quote: ProductSelectionQuoteResponse = {
  productId: "coffee", productName: "Coffee", currency: "PHP",
  basePrice: "1.00", unitPrice: "1.20", totalPrice: "2.40", quantity: 2,
  notes: "Less ice",
  variants: [],
  addOns: [{ id: "milk", name: "Milk", priceAdjustment: "0.20" }],
};
beforeEach(() => {
  useCart.setState({ shops: {} });
  useFeedbackStore.getState().clear();
});
it("protects unsaved notes on cart dismissal while retaining saved cart lines", async () => {
  const show = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
  const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  useCart.getState().add("cafe", quote, createCartPricePreview(quote));
  const view = render(<MemoryRouter><CustomerCart shop={{ name: "Cafe", slug: "cafe", description: null }} /></MemoryRouter>);
  try {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "View cart (2)" }));
    await user.click(screen.getByRole("button", { name: /notes for Coffee/ }));
    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "No sugar");
    await user.click(screen.getByRole("button", { name: "Continue shopping" }));
    expect(await screen.findByRole("dialog", { name: "Discard unsaved cart edits?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByRole("textbox")).toHaveValue("No sugar");
    await user.click(screen.getByRole("button", { name: "Continue shopping" }));
    await user.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(useCart.getState().shops.cafe[0].notes).toBe("Less ice");
    expect(useCart.getState().shops.cafe[0].quantity).toBe(2);
  } finally {
    view.unmount();
    if (show) Object.defineProperty(HTMLDialogElement.prototype, "showModal", show); else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
    if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
  }
});
function setup(notes: string | undefined = "Less ice") {
  useCart.getState().add("cafe", { ...quote, notes }, createCartPricePreview(quote));
  function Line() {
    const item = useCart((state) => state.shops.cafe[0]);
    return item ? <CartNotesEditor item={item} shopSlug="cafe" /> : null;
  }
  return render(<Line />);
}
async function edit() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /notes for Coffee/ }));
  return { user, field: screen.getByRole("textbox") };
}
it("edits, normalizes and renders notes as text while preserving all other line data", async () => {
  setup();
  useCart.getState().add("cafe", quote);
  useCart.getState().add("other", quote);
  const before = useCart.getState();
  const { user, field } = await edit();
  expect(field).toHaveValue("Less ice");
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: "  <b>No sugar</b>\r\nExtra hot  " } });
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(screen.getByText("<b>No sugar</b> Extra hot")).toBeInTheDocument();
  expect(document.querySelector(".customer-cart-notes b")).toBeNull();
  const after = useCart.getState();
  expect(after.shops.cafe[0]).toEqual({ ...before.shops.cafe[0], notes: "<b>No sugar</b>\nExtra hot" });
  expect(after.shops.cafe[1]).toBe(before.shops.cafe[1]);
  expect(after.shops.other).toBe(before.shops.other);
  expect(cartCheckoutLines(after.shops, "cafe")[0].notes).toBe("<b>No sugar</b>\nExtra hot");
  await waitFor(() => expect(screen.getByRole("button", { name: "Edit notes for Coffee" })).toHaveFocus());
});
it("cancels a draft without changing saved notes", async () => {
  setup();
  const before = useCart.getState();
  const { user, field } = await edit();
  await user.clear(field);
  await user.type(field, "No ice");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByText("Less ice")).toBeInTheDocument();
  expect(useCart.getState()).toBe(before);
  await edit();
  expect(screen.getByRole("textbox")).toHaveValue("Less ice");
});
it("adds optional notes and clears them from display and submission data", async () => {
  setup("");
  const { user, field } = await edit();
  expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
  await user.type(field, "No onions");
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(screen.getByText("No onions")).toBeInTheDocument();
  await edit();
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "   ");
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(screen.queryByText("No onions")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add notes for Coffee" })).toBeInTheDocument();
  expect(Object.hasOwn(useCart.getState().shops.cafe[0], "notes")).toBe(false);
  expect(Object.hasOwn(cartCheckoutLines(useCart.getState().shops, "cafe")[0], "notes")).toBe(false);
});
it.each(["x".repeat(301), "bad\u0000note", "bad\u202enote"])("rejects unsupported or oversized notes", async (value) => {
  setup();
  const before = useCart.getState();
  const { field } = await edit();
  fireEvent.change(field, { target: { value } });
  expect(screen.getByRole("alert")).toHaveTextContent("plain text up to 300 characters");
  expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
  expect(useCart.getState().updateNotes("cafe", before.shops.cafe[0], value)).toBe(false);
  expect(useCart.getState()).toBe(before);
});
it("accepts 300 characters and prevents stale drafts from overwriting updated items", async () => {
  setup();
  const { user, field } = await edit();
  fireEvent.change(field, { target: { value: "x".repeat(300) } });
  expect(screen.getByRole("button", { name: "Save notes" })).toBeEnabled();
  const original = useCart.getState().shops.cafe[0];
  act(() => { useCart.getState().updateNotes("cafe", original, "Changed elsewhere"); });
  const beforeSave = useCart.getState();
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(screen.getByRole("alert")).toHaveTextContent("cart item changed");
  expect(screen.getByRole("textbox")).toHaveValue("x".repeat(300));
  expect(useCart.getState()).toBe(beforeSave);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await edit();
  expect(screen.getByRole("textbox")).toHaveValue("Changed elsewhere");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "x".repeat(300) } });
  await user.click(screen.getByRole("button", { name: "Save notes" }));
  expect(useCart.getState().shops.cafe[0].notes).toHaveLength(300);
});
it("does not edit an unknown shop or resurrect a removed line", () => {
  setup();
  const original = useCart.getState().shops.cafe[0];
  expect(useCart.getState().updateNotes("other", original, "Hot")).toBe(false);
  act(() => { useCart.getState().remove("cafe", original.lineId); });
  const after = useCart.getState();
  expect(useCart.getState().updateNotes("cafe", original, "Hot")).toBe(false);
  expect(useCart.getState()).toBe(after);
});

it("rejects quantity quotes that change or drop saved notes", () => {
  setup();
  const before = useCart.getState();
  const original = before.shops.cafe[0];
  for (const notes of [undefined, "Different instruction"]) {
    const changed = { ...quote, notes, quantity: 3, totalPrice: "3.60" };
    expect(useCart.getState().updateQuantity("cafe", original, changed, createCartPricePreview(changed))).toBe(false);
    expect(useCart.getState()).toBe(before);
  }
});
