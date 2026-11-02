import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PublicMenuQr, PublicMenuQrDialog } from "./PublicMenuQr";
import { api } from "../../lib/api/client";
import {
  generatePublicMenuQr,
  isLoopbackMenuUrl,
} from "../../features/shops/public-menu-qr";
vi.mock("../../lib/api/client", () => ({ api: { get: vi.fn() } }));
vi.mock("../../features/shops/public-menu-qr", () => ({
  generatePublicMenuQr: vi.fn(),
  isLoopbackMenuUrl: vi.fn(() => false),
}));
const shop = {
  name: "Cafe A",
  slug: "cafe-a",
  description: null,
  logoUrl: "https://cdn.example/logo.png",
  primaryColor: "#253a32",
  accentColor: "#c9ef83",
};
const qr = {
  url: "https://site.test/menu/cafe-a?service=pickup",
  svg: "<svg/>",
  imageUrl: "data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E",
};
function setup() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PublicMenuQrDialog shopSlug="cafe-a" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { shop } });
  vi.mocked(generatePublicMenuQr).mockResolvedValue(qr);
  vi.mocked(isLoopbackMenuUrl).mockReturnValue(false);
  vi.spyOn(window, "print").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it("loads saved public branding only when opened and prints after both images settle", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PublicMenuQr shopSlug="cafe-a" />
    </QueryClientProvider>,
  );
  expect(api.get).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Public menu QR" }));
  const card = await screen.findByRole("article", {
    name: "Printable pickup menu card for Cafe A",
  });
  expect(card.style.getPropertyValue("--menu-primary").toLowerCase()).toBe(
    "#253a32",
  );
  expect(api.get).toHaveBeenCalledWith(
    "/menu/cafe-a",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const print = screen.getByRole("button", { name: "Print menu card" });
  expect(print).toBeDisabled();
  fireEvent.load(screen.getByRole("img", { name: /Scan to open/ }));
  expect(print).toBeDisabled();
  fireEvent.load(card.querySelector(".public-menu-qr-logo img")!);
  expect(print).toBeEnabled();
  await userEvent.click(print);
  expect(window.print).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Download QR SVG" })).toHaveAttribute(
    "href",
    qr.imageUrl,
  );
  expect(screen.getByRole("link", { name: "Test menu link" })).toHaveAttribute(
    "href",
    qr.url,
  );
});
it("allows logo fallback but rejects failed QR images", async () => {
  setup();
  const card = await screen.findByRole("article");
  fireEvent.error(card.querySelector(".public-menu-qr-logo img")!);
  fireEvent.load(screen.getByRole("img", { name: /Scan to open/ }));
  expect(screen.getByRole("button", { name: "Print menu card" })).toBeEnabled();
  expect(screen.getByText(/shop initial/)).toBeInTheDocument();
  fireEvent.error(screen.getByRole("img", { name: /Scan to open/ }));
  expect(
    screen.queryByRole("button", { name: "Print menu card" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "QR image could not load",
  );
});
it("allows a clearly labelled localhost test print after images load", async () => {
  vi.mocked(isLoopbackMenuUrl).mockReturnValue(true);
  setup();
  const card = await screen.findByRole("article");
  expect(
    screen.getByRole("button", { name: "Print test card" }),
  ).toBeDisabled();
  fireEvent.load(card.querySelector(".public-menu-qr-logo img")!);
  fireEvent.load(screen.getByRole("img", { name: /Scan to open/ }));
  expect(screen.getByRole("button", { name: "Print test card" })).toBeEnabled();
  expect(card).toHaveTextContent("LOCAL TEST COPY");
  await userEvent.click(
    screen.getByRole("button", { name: "Print test card" }),
  );
  expect(window.print).toHaveBeenCalledOnce();
  expect(screen.getByRole("status")).toHaveTextContent("only on this computer");
  expect(
    screen.queryByRole("link", { name: "Download QR SVG" }),
  ).not.toBeInTheDocument();
});
it.each([
  { shop: { ...shop, slug: "other-shop" } },
  { shop, table: { code: "saved-table" } },
])(
  "rejects wrong-shop or table-bound responses before QR generation",
  async (response) => {
    vi.mocked(api.get).mockResolvedValue({ data: response });
    setup();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "public menu is unavailable",
    );
    expect(generatePublicMenuQr).not.toHaveBeenCalled();
  },
);
it("recovers from generation failure and reports print failures without losing the card", async () => {
  vi.mocked(generatePublicMenuQr).mockRejectedValueOnce(
    new Error("private error"),
  );
  setup();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not create",
  );
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  const card = await screen.findByRole("article");
  fireEvent.load(card.querySelector(".public-menu-qr-logo img")!);
  fireEvent.load(screen.getByRole("img", { name: /Scan to open/ }));
  vi.mocked(window.print).mockImplementation(() => {
    throw new Error("blocked");
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Print menu card" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "print dialog could not open",
  );
  expect(screen.getByRole("article")).toBeInTheDocument();
});
it("closes with Escape and restores focus to the opener", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PublicMenuQr shopSlug="cafe-a" />
    </QueryClientProvider>,
  );
  const opener = screen.getByRole("button", { name: "Public menu QR" });
  await userEvent.click(opener);
  const dialog = await screen.findByRole("dialog");
  expect(
    screen.getByRole("button", { name: "Close public menu QR" }),
  ).toHaveFocus();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(opener).toHaveFocus();
});
