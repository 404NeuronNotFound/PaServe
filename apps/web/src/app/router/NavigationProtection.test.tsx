import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, Outlet, RouterProvider } from "react-router-dom";
import { NavigationProtection } from "./NavigationProtection";
import { useDraftGuard } from "./useDraftGuard";

const showModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const close = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => {
  vi.restoreAllMocks();
  if (showModal) Object.defineProperty(HTMLDialogElement.prototype, "showModal", showModal); else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  if (close) Object.defineProperty(HTMLDialogElement.prototype, "close", close); else delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});
function Form() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useDraftGuard(Boolean(value), busy);
  return <><label>Name<input value={value} onChange={(event) => setValue(event.target.value)} /></label>
    <Link to="/other">Sidebar destination</Link><Link to="/other">Breadcrumb destination</Link>
    <button onClick={() => setValue("")}>Save draft</button>
    <button onClick={() => setBusy(!busy)}>Toggle request</button></>;
}
function setup() {
  const router = createMemoryRouter([{ element: <NavigationProtection><Outlet /></NavigationProtection>, children: [
    { path: "/form", element: <Form /> }, { path: "/other", element: <h1>Other page</h1> },
  ] }], { initialEntries: ["/other", "/form"], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return router;
}
it.each(["Sidebar destination", "Breadcrumb destination"])("preserves a cancelled draft when leaving through %s", async (name) => {
  setup(); const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Unsaved cafe");
  await user.click(screen.getByRole("link", { name }));
  const dialog = await screen.findByRole("dialog", { name: "Leave this page?" });
  await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Unsaved cafe");
  expect(screen.queryByRole("heading", { name: "Other page" })).not.toBeInTheDocument();
});
it("blocks browser history, retains a cancelled draft and proceeds only after explicit discard", async () => {
  const router = setup(); const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Unsaved");
  await act(async () => { await router.navigate(-1); });
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Unsaved");
  await act(async () => { await router.navigate(-1); });
  await user.click(screen.getByRole("button", { name: "Discard and leave" }));
  expect(await screen.findByRole("heading", { name: "Other page" })).toBeInTheDocument();
});
it("blocks leaving during writes but keeps cancellation reachable", async () => {
  setup(); const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Toggle request" }));
  await user.click(screen.getByRole("link", { name: "Sidebar destination" }));
  const dialog = await screen.findByRole("dialog", { name: "Action in progress" });
  expect(within(dialog).getByRole("button", { name: "Leave page" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "Keep editing" }));
  expect(screen.getByLabelText("Name")).toBeInTheDocument();
});
it("allows leaving after saving and warns on hard reload only while dirty", async () => {
  setup(); const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "Draft");
  const event = new Event("beforeunload", { cancelable: true });
  fireEvent(window, event); expect(event.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  await user.click(screen.getByRole("link", { name: "Breadcrumb destination" }));
  expect(await screen.findByRole("heading", { name: "Other page" })).toBeInTheDocument();
});
