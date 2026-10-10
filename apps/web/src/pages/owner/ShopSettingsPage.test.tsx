import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ShopSettings, UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { getShopSettings, updateShop } from "../../features/shops/api/context";
import { ShopSettingsPage } from "./ShopSettingsPage";
import { uploadShopBanner } from "../../features/shops/api/banner";
import { useFeedbackStore } from "../../app/stores/feedback";
import { activeShopKey } from "../../features/shops/active-shop";
import { FeedbackHost } from "../../components/feedback/FeedbackHost";

const modalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    }),
  });
});

vi.mock("../../features/shops/api/context", () => ({
  getShopSettings: vi.fn(),
  updateShop: vi.fn(),
}));
vi.mock("../../features/shops/api/banner", () => ({
  uploadShopBanner: vi.fn(),
}));
const shop: ShopSettings = {
  id: "shop-a",
  name: "Cafe A",
  slug: "cafe-a",
  description: null,
  isActive: true,
  createdAt: "2026-10-09",
  displayName: null,
  phone: "+63 9123456789",
  contactEmail: null,
  website: null,
  address: null,
  operatingHours: null,
};
const membership: UserMembership = {
  id: "member-a",
  shopId: shop.id,
  role: "OWNER",
  shop: { id: shop.id, name: shop.name, slug: shop.slug, isActive: true },
};

it("saves a banner without losing business edits and locks conflicting controls during upload", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  let complete!: (value: { shop: ShopSettings; storagePath: string }) => void;
  vi.mocked(uploadShopBanner).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  setup();
  const user = userEvent.setup();
  const business = await screen.findByLabelText("Business name (required)");
  await user.clear(business);
  await user.type(business, "Unsaved new name");
  await user.upload(
    screen.getByLabelText("Choose banner"),
    new File(["image"], "banner.png", { type: "image/png" }),
  );
  await user.click(screen.getByRole("button", { name: "Upload banner" }));
  expect(business).toBeDisabled();
  expect(screen.getByLabelText("Choose logo")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  complete({
    shop: { ...shop, bannerUrl: "https://example.com/banner.webp" },
    storagePath: "shop-a/banner/new.webp",
  });
  await vi.waitFor(() => expect(business).toBeEnabled());
  expect(business).toHaveValue("Unsaved new name");
  expect(screen.getByRole("img", { name: "Cafe A banner" })).toHaveAttribute(
    "src",
    "https://example.com/banner.webp",
  );
  expect(screen.getByRole("button", { name: "Save settings" })).toBeEnabled();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  if (modalDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      modalDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (closeDescriptor)
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  useFeedbackStore.getState().clear();
});
function setup(role: UserMembership["role"] = "OWNER") {
  const client = new QueryClient();
  client.setQueryData(["auth", "me"], {
    user: { id: "user-a", memberships: [membership] },
  });
  render(
    <QueryClientProvider client={client}>
      <FeedbackHost />
      <MemoryRouter>
        <ActiveShopContext.Provider value={{ ...membership, role }}>
          <ShopSettingsPage />
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it("loads current values and saves only changed fields to the active shop", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  vi.mocked(updateShop).mockResolvedValue({
    shop: { ...shop, name: "Cafe Renamed", operatingHours: "Daily 8–6" },
  });
  const client = setup();
  const user = userEvent.setup();
  expect(await screen.findByLabelText("Phone")).toHaveValue("+63 9123456789");
  expect(screen.getByRole("button", { name: "Save settings" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Business name (required)"));
  await user.type(
    screen.getByLabelText("Business name (required)"),
    "Cafe Renamed",
  );
  await user.type(screen.getByLabelText("Operating hours"), "Daily 8–6");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  expect(updateShop).toHaveBeenCalledWith("shop-a", {
    name: "Cafe Renamed",
    operatingHours: "Daily 8–6",
  });
  await vi.waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Save settings" }),
    ).toBeDisabled(),
  );
  expect(
    client.getQueryData<{ user: { memberships: UserMembership[] } }>([
      "auth",
      "me",
    ])!.user.memberships[0].shop.name,
  ).toBe("Cafe Renamed");
  expect(screen.getByText("cafe-a")).toBeInTheDocument();
});
it("keeps non-owner members out of settings without fetching them", async () => {
  setup("CASHIER");
  expect(
    await screen.findByRole("heading", { name: "Owner access required" }),
  ).toBeInTheDocument();
  expect(getShopSettings).not.toHaveBeenCalled();
});
it("validates required names, email and website inline without sending changes", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  setup();
  const user = userEvent.setup();
  await user.clear(await screen.findByLabelText("Business name (required)"));
  await user.type(screen.getByLabelText("Contact email"), "bad-email");
  await user.type(screen.getByLabelText("Website"), "javascript:alert(1)");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  expect(
    await screen.findByText("Enter your business name."),
  ).toBeInTheDocument();
  expect(screen.getByText("Enter a valid contact email.")).toBeInTheDocument();
  expect(
    screen.getByText("Enter a full http:// or https:// website address."),
  ).toBeInTheDocument();
  expect(updateShop).not.toHaveBeenCalled();
});
it("preserves edits after a save fails and permits retry", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  vi.mocked(updateShop)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ shop: { ...shop, phone: null } });
  setup();
  const user = userEvent.setup();
  await user.clear(await screen.findByLabelText("Phone"));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your edits are still here",
  );
  expect(screen.getByLabelText("Phone")).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  expect(updateShop).toHaveBeenLastCalledWith("shop-a", { phone: "" });
});
it("recovers from a failed settings load", async () => {
  vi.mocked(getShopSettings)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ shop });
  setup();
  const user = userEvent.setup();
  expect(
    await screen.findByRole("heading", { name: "Unable to load settings" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("Phone")).toHaveValue("+63 9123456789");
});

it("does not populate another account's caches when an earlier save finishes", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  let complete!: (value: { shop: ShopSettings }) => void;
  vi.mocked(updateShop).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const client = setup();
  const user = userEvent.setup();
  await user.clear(await screen.findByLabelText("Phone"));
  await user.click(screen.getByRole("button", { name: "Save settings" }));
  client.setQueryData(["auth", "me"], {
    user: { id: "other-user", memberships: [] },
  });
  client.removeQueries({ queryKey: ["shops"] });
  complete({ shop: { ...shop, phone: null } });
  await vi.waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Saving…" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    client.getQueryData(activeShopKey("other-user", shop.id)),
  ).toBeUndefined();
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});

it("uses phone/email keyboards and rejects phone letters without losing leading zeroes", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  setup();
  const user = userEvent.setup();
  const phone = await screen.findByLabelText("Phone");
  expect(phone).toHaveAttribute("type", "tel");
  expect(phone).toHaveAttribute("inputmode", "tel");
  expect(screen.getByLabelText("Contact email")).toHaveAttribute(
    "type",
    "email",
  );
  await user.clear(phone);
  await user.type(phone, "09123456789a");
  expect(phone).toHaveValue("09123456789");
  expect(
    await screen.findByText(
      "Use digits for your phone number; letters are not allowed.",
    ),
  ).toBeInTheDocument();
});

it("requires confirmation to reset a draft and offers a working Undo snackbar", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  setup();
  const user = userEvent.setup();
  const name = await screen.findByLabelText("Business name (required)");
  await user.clear(name);
  await user.type(name, "Changed Cafe");
  await user.click(screen.getByRole("button", { name: "Reset changes" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Discard unsaved changes?",
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Keep editing" }),
  );
  expect(name).toHaveValue("Changed Cafe");
  await user.click(screen.getByRole("button", { name: "Reset changes" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", {
      name: "Reset changes",
    }),
  );
  expect(name).toHaveValue("Cafe A");
  await user.click(await screen.findByRole("button", { name: "Undo" }));
  expect(name).toHaveValue("Changed Cafe");
  expect(updateShop).not.toHaveBeenCalled();
});

it("asks before leaving via the form's back action and preserves a cancelled draft", async () => {
  vi.mocked(getShopSettings).mockResolvedValue({ shop });
  setup();
  const user = userEvent.setup();
  const name = await screen.findByLabelText("Business name (required)");
  await user.type(name, " edited");
  await user.click(screen.getByRole("link", { name: "Back to shop" }));
  expect(
    await screen.findByRole("dialog", { name: "Discard unsaved changes?" }),
  ).toBeInTheDocument();
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Keep editing",
    }),
  );
  expect(name).toHaveValue("Cafe A edited");
});
