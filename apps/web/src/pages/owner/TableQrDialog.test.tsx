import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TableQrDialog } from "./TableQrDialog";
import { generateTableQr, tableQrOrigin } from "../../features/shops/table-qr";
vi.mock("../../features/shops/table-qr", () => ({
  generateTableQr: vi.fn(),
  tableQrOrigin: vi.fn(),
}));
const code = "t_9dd21e8326b440b2a73f22d4f16c038a";
const table = {
  id: "internal-id",
  shopId: "shop-a",
  number: "Patio 4",
  code,
  isActive: true,
  createdAt: "2026-10-11T00:00:00Z",
};
const shop = { id: "shop-a", name: "Cafe A", slug: "cafe-a" };
const qr = {
  url: `https://menu.example.com/cafe-a/table/${code}`,
  svg: "<svg></svg>",
  imageUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E",
};
const dialogMethods = ["showModal", "close"] as const;
const originalDialogMethods = dialogMethods.map((name) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(tableQrOrigin).mockReturnValue("https://menu.example.com");
  vi.mocked(generateTableQr).mockResolvedValue(qr);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
  vi.spyOn(window, "print").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dialogMethods.forEach((name, index) => {
    const original = originalDialogMethods[index];
    if (original)
      Object.defineProperty(HTMLDialogElement.prototype, name, original);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  });
});
it("previews the saved table URL and downloads the same SVG, without internal IDs", async () => {
  render(<TableQrDialog table={table} shop={shop} onClose={() => {}} />);
  await screen.findByRole("img");
  expect(generateTableQr).toHaveBeenCalledWith(
    shop.slug,
    table.code,
    "https://menu.example.com",
  );
  expect(screen.getByText("Table Patio 4")).toBeInTheDocument();
  expect(screen.getByText(qr.url)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Download SVG" })).toHaveAttribute(
    "href",
    qr.imageUrl,
  );
  expect(screen.getByRole("link", { name: "Download SVG" })).toHaveAttribute(
    "download",
    `cafe-a-table-${code}.svg`,
  );
  expect(document.body.textContent).not.toContain(table.id);
});
it("prints only after the preview image loads", async () => {
  render(<TableQrDialog table={table} shop={shop} onClose={() => {}} />);
  expect(screen.getByRole("button", { name: "Print card" })).toBeDisabled();
  const image = await screen.findByRole("img");
  expect(screen.getByRole("button", { name: "Print card" })).toBeDisabled();
  fireEvent.load(image);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Print card" }));
  expect(window.print).toHaveBeenCalledTimes(1);
});
it("shows generation failure and allows a successful retry", async () => {
  vi.mocked(generateTableQr).mockRejectedValueOnce(
    new Error("encoding failed"),
  );
  render(<TableQrDialog table={table} shop={shop} onClose={() => {}} />);
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("link", { name: "Download SVG" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Print card" })).toBeDisabled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("img");
  expect(generateTableQr).toHaveBeenCalledTimes(2);
});
it.each([
  { ...table, shopId: "foreign-shop" },
  { ...table, isActive: false },
])("rejects a foreign or inactive table", (table) => {
  render(<TableQrDialog table={table} shop={shop} onClose={() => {}} />);
  expect(screen.getByRole("alert")).toHaveTextContent(/unavailable/);
  expect(generateTableQr).not.toHaveBeenCalled();
});
it("ignores generation that completes after the dialog closes", async () => {
  let resolve!: (qr: Awaited<ReturnType<typeof generateTableQr>>) => void;
  vi.mocked(generateTableQr).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = render(
    <TableQrDialog table={table} shop={shop} onClose={() => {}} />,
  );
  view.unmount();
  resolve(qr);
  await waitFor(() =>
    expect(screen.queryByRole("img")).not.toBeInTheDocument(),
  );
});
it("reports image-loading failures and keeps printing disabled", async () => {
  render(<TableQrDialog table={table} shop={shop} onClose={() => {}} />);
  fireEvent.error(await screen.findByRole("img"));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Print card" })).toBeDisabled();
});
it("closes on Escape and returns focus to the opener", async () => {
  const onClose = vi.fn();
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const view = render(
    <TableQrDialog table={table} shop={shop} onClose={onClose} />,
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
  view.unmount();
  await waitFor(() => expect(trigger).toHaveFocus());
  trigger.remove();
});
