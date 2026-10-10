import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShopLogoUpload } from "./ShopLogoUpload";
import { uploadShopLogo } from "../../features/shops/api/logo";
import { activeShopKey } from "../../features/shops/active-shop";
import { useFeedbackStore } from "../../app/stores/feedback";

vi.mock("../../features/shops/api/logo", () => ({ uploadShopLogo: vi.fn() }));
const membership = {
  id: "member",
  shopId: "shop",
  role: "OWNER",
  shop: {
    id: "shop",
    name: "Cafe",
    slug: "cafe",
    isActive: true,
    logoUrl: "https://example.com/old.webp",
  },
};
const result = {
  shop: {
    ...membership.shop,
    createdAt: "2026-10-10",
    logoUrl: "https://example.com/new.webp",
    description: null,
    displayName: null,
    phone: null,
    contactEmail: null,
    website: null,
    address: null,
    operatingHours: null,
  },
  storagePath: "shop/logo/new.webp",
};
beforeEach(() => {
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
      logoUrl: membership.shop.logoUrl,
      name: "Original details",
    },
  });
  const onPending = vi.fn(),
    onDirty = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ShopLogoUpload
        shopId="shop"
        membershipId="member"
        name="Cafe"
        logoUrl={membership.shop.logoUrl}
        disabled={false}
        onPending={onPending}
        onDirty={onDirty}
      />
    </QueryClientProvider>,
  );
  return { client, onPending, onDirty };
}
const file = () => new File(["image"], "logo.png", { type: "image/png" });
it("uploads a selected logo and updates shop identities without overwriting text details", async () => {
  vi.mocked(uploadShopLogo).mockResolvedValue(result);
  const { client, onPending } = setup();
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Replace logo"), file());
  expect(
    screen.getByRole("img", { name: "Selected logo preview logo" }),
  ).toHaveAttribute("src", "blob:preview");
  await user.click(screen.getByRole("button", { name: "Upload logo" }));
  expect(uploadShopLogo).toHaveBeenCalledWith(
    "shop",
    expect.any(File),
    expect.any(Function),
  );
  await vi.waitFor(() =>
    expect(screen.getByRole("img", { name: "Cafe logo" })).toHaveAttribute(
      "src",
      result.shop.logoUrl,
    ),
  );
  expect(
    client.getQueryData(["shops", "member", "shop", "settings"]),
  ).toMatchObject({
    shop: { name: "Original details", logoUrl: result.shop.logoUrl },
  });
  expect(client.getQueryData(activeShopKey("user", "shop"))).toMatchObject({
    shop: { logoUrl: result.shop.logoUrl },
  });
  expect(client.getQueryData(["auth", "me"])).toMatchObject({
    user: { memberships: [{ shop: { logoUrl: result.shop.logoUrl } }] },
  });
  expect(onPending).toHaveBeenLastCalledWith(false);
});
it("rejects oversized and unsupported selections without uploading", () => {
  setup();
  fireEvent.change(screen.getByLabelText("Replace logo"), {
    target: {
      files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })],
    },
  });
  expect(
    screen.getByText("Choose a JPEG, PNG or WebP logo."),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Replace logo"), {
    target: {
      files: [
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ],
    },
  });
  expect(
    screen.getByText("Choose a logo between 1 byte and 5 MB."),
  ).toBeInTheDocument();
  expect(uploadShopLogo).not.toHaveBeenCalled();
});
it("keeps the saved logo when the selection is cancelled", async () => {
  const { onDirty } = setup();
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Replace logo"), file());
  await user.click(screen.getByRole("button", { name: "Cancel selection" }));
  expect(screen.getByRole("img", { name: "Cafe logo" })).toHaveAttribute(
    "src",
    membership.shop.logoUrl,
  );
  expect(onDirty).toHaveBeenLastCalledWith(false);
});
it("retains the selection for retry after a known storage failure", async () => {
  vi.mocked(uploadShopLogo).mockRejectedValue({
    isAxiosError: true,
    response: { status: 503, data: { code: "SHOP_LOGO_STORAGE_UNAVAILABLE" } },
  });
  setup();
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Replace logo"), file());
  await user.click(screen.getByRole("button", { name: "Upload logo" }));
  await screen.findByText(/Logo uploads are unavailable/);
  expect(screen.getByRole("button", { name: "Upload logo" })).toBeEnabled();
  expect(
    screen.getByRole("img", { name: "Selected logo preview logo" }),
  ).toBeInTheDocument();
});
it("locks retries after an uncertain save", async () => {
  vi.mocked(uploadShopLogo).mockRejectedValue(new Error("Disconnected"));
  setup();
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Replace logo"), file());
  await user.click(screen.getByRole("button", { name: "Upload logo" }));
  await screen.findByText(/We could not confirm/);
  expect(screen.getByRole("button", { name: "Upload logo" })).toBeDisabled();
});
it("does not repopulate caches after an account change while uploading", async () => {
  let complete!: (value: typeof result) => void;
  vi.mocked(uploadShopLogo).mockReturnValue(
    new Promise((resolve) => {
      complete = resolve;
    }),
  );
  const { client } = setup();
  const user = userEvent.setup();
  await user.upload(screen.getByLabelText("Replace logo"), file());
  await user.click(screen.getByRole("button", { name: "Upload logo" }));
  client.setQueryData(["auth", "me"], {
    user: { id: "other-user", memberships: [] },
  });
  complete(result);
  await vi.waitFor(() =>
    expect(client.getQueryData(activeShopKey("user", "shop"))).toMatchObject({
      shop: { logoUrl: membership.shop.logoUrl },
    }),
  );
  expect(client.getQueryData(["auth", "me"])).toMatchObject({
    user: { id: "other-user", memberships: [] },
  });
});
