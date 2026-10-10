import { installCropPlatform, selectAndCrop } from "../../test/crop-platform";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShopBannerUpload } from "./ShopBannerUpload";
import { uploadShopBanner } from "../../features/shops/api/banner";
import { activeShopKey } from "../../features/shops/active-shop";
import { useFeedbackStore } from "../../app/stores/feedback";

vi.mock("../../features/shops/api/banner", () => ({
  uploadShopBanner: vi.fn(),
}));
const membership = {
  id: "member",
  shopId: "shop",
  role: "OWNER",
  shop: {
    id: "shop",
    name: "Cafe",
    slug: "cafe",
    isActive: true,
    bannerUrl: "https://example.com/old.webp",
  },
};
const result = {
  shop: {
    ...membership.shop,
    createdAt: "2026-10-10",
    bannerUrl: "https://example.com/new.webp",
    description: null,
    displayName: null,
    phone: null,
    contactEmail: null,
    website: null,
    address: null,
    operatingHours: null,
  },
  storagePath: "shop/banner/new.webp",
};
beforeEach(() => {
  installCropPlatform();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useFeedbackStore.getState().clear();
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["auth", "me"], {
    user: { id: "user", memberships: [membership] },
  });
  client.setQueryData(activeShopKey("user", "shop"), membership);
  client.setQueryData(["shops", "member", "shop", "settings"], {
    shop: {
      ...result.shop,
      bannerUrl: membership.shop.bannerUrl,
      name: "Original details",
    },
  });
  const onPending = vi.fn(),
    onDirty = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ShopBannerUpload
        shopId="shop"
        membershipId="member"
        name="Cafe"
        bannerUrl={membership.shop.bannerUrl}
        disabled={false}
        onPending={onPending}
        onDirty={onDirty}
      />
    </QueryClientProvider>,
  );
  return { client, onPending, onDirty };
}
const file = () => new File(["image"], "banner.png", { type: "image/png" });
it("uploads a selected banner and updates saved settings without overwriting text details", async () => {
  vi.mocked(uploadShopBanner).mockResolvedValue(result);
  const { client, onPending } = setup();
  const user = userEvent.setup();
  await selectAndCrop(user, screen.getByLabelText(/Banner.*optional/), file());
  expect(
    screen.getByRole("img", { name: "Selected banner photo preview" }),
  ).toHaveAttribute("src", "blob:preview");
  await user.click(screen.getByRole("button", { name: "Upload banner" }));
  expect(uploadShopBanner).toHaveBeenCalledWith(
    "shop",
    expect.any(File),
    expect.any(Function),
  );
  await vi.waitFor(() =>
    expect(
      screen.getByRole("img", { name: "Current banner photo" }),
    ).toHaveAttribute("src", result.shop.bannerUrl),
  );
  expect(
    client.getQueryData(["shops", "member", "shop", "settings"]),
  ).toMatchObject({
    shop: { name: "Original details", bannerUrl: result.shop.bannerUrl },
  });
  expect(onPending).toHaveBeenLastCalledWith(false);
});
it("rejects oversized and unsupported selections without uploading", () => {
  setup();
  fireEvent.change(screen.getByLabelText(/Banner.*optional/), {
    target: {
      files: [new File(["<svg/>"], "banner.svg", { type: "image/svg+xml" })],
    },
  });
  expect(
    screen.getByText("Choose a JPEG, PNG or WebP image."),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Banner.*optional/), {
    target: {
      files: [
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ],
    },
  });
  expect(
    screen.getByText("Choose an image between 1 byte and 5 MB."),
  ).toBeInTheDocument();
  expect(uploadShopBanner).not.toHaveBeenCalled();
});
it("keeps the saved banner when the selection is cancelled", async () => {
  const { onDirty } = setup();
  const user = userEvent.setup();
  await selectAndCrop(user, screen.getByLabelText(/Banner.*optional/), file());
  await user.click(screen.getByRole("button", { name: "Cancel selection" }));
  expect(
    screen.getByRole("img", { name: "Current banner photo" }),
  ).toHaveAttribute("src", membership.shop.bannerUrl);
  expect(onDirty).toHaveBeenLastCalledWith(false);
});
it("retains the selection for retry after a known storage failure", async () => {
  vi.mocked(uploadShopBanner).mockRejectedValue({
    isAxiosError: true,
    response: {
      status: 503,
      data: { code: "SHOP_BANNER_STORAGE_UNAVAILABLE" },
    },
  });
  setup();
  const user = userEvent.setup();
  await selectAndCrop(user, screen.getByLabelText(/Banner.*optional/), file());
  await user.click(screen.getByRole("button", { name: "Upload banner" }));
  await screen.findByText(/Banner uploads are unavailable/);
  expect(screen.getByRole("button", { name: "Upload banner" })).toBeEnabled();
  expect(
    screen.getByRole("img", { name: "Selected banner photo preview" }),
  ).toBeInTheDocument();
});
it("locks retries after an uncertain save", async () => {
  vi.mocked(uploadShopBanner).mockRejectedValue(new Error("Disconnected"));
  setup();
  const user = userEvent.setup();
  await selectAndCrop(user, screen.getByLabelText(/Banner.*optional/), file());
  await user.click(screen.getByRole("button", { name: "Upload banner" }));
  await screen.findByText(/We could not confirm/);
  expect(screen.getByRole("button", { name: "Upload banner" })).toBeDisabled();
});
it("does not repopulate caches after an account change while uploading", async () => {
  let complete!: (value: typeof result) => void;
  vi.mocked(uploadShopBanner).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const { client } = setup();
  const user = userEvent.setup();
  await selectAndCrop(user, screen.getByLabelText(/Banner.*optional/), file());
  await user.click(screen.getByRole("button", { name: "Upload banner" }));
  client.setQueryData(["auth", "me"], {
    user: { id: "other-user", memberships: [] },
  });
  complete(result);
  await vi.waitFor(() =>
    expect(client.getQueryData(activeShopKey("user", "shop"))).toMatchObject({
      shop: { bannerUrl: membership.shop.bannerUrl },
    }),
  );
  expect(client.getQueryData(["auth", "me"])).toMatchObject({
    user: { id: "other-user", memberships: [] },
  });
});
