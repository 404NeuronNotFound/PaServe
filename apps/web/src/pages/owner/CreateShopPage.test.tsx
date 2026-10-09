import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AxiosError, AxiosHeaders } from "axios";
import type { CreateShopResponse } from "@paserve/contracts";
import { CreateShopPage } from "./CreateShopPage";
import { AccountPage } from "./AccountPage";
import { createShop } from "../../features/shops/api/create";
import { currentUserKey } from "../../features/auth/api/session";
import { FeedbackHost } from "../../components/feedback/FeedbackHost";
import { useFeedbackStore } from "../../app/stores/feedback";

vi.mock("../../features/shops/api/create", () => ({ createShop: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
  useFeedbackStore.getState().clear();
});

const shop = {
  id: "shop-id",
  name: "Café North",
  slug: "cafe-north",
  isActive: true,
};
const result: CreateShopResponse = {
  shop: {
    ...shop,
    description: "Coffee and pastries",
    createdAt: "2026-10-09T00:00:00Z",
  },
  membership: { id: "member-id", shopId: shop.id, role: "OWNER", shop },
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(currentUserKey, {
    user: { id: "user-id", email: "owner@example.com", memberships: [] },
  });
  render(
    <QueryClientProvider client={client}>
      <FeedbackHost />
      <MemoryRouter initialEntries={["/app/onboarding/create-shop"]}>
        <Routes>
          <Route
            path="/app/onboarding/create-shop"
            element={<CreateShopPage />}
          />
          <Route path="/app/account" element={<AccountPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}

it("validates a blank name locally and focuses the field without submitting", async () => {
  const { user } = setup();
  await user.type(screen.getByLabelText("Shop name"), "   ");
  await user.click(screen.getByRole("button", { name: "Create shop" }));
  expect(await screen.findByText("Enter your shop name.")).toBeInTheDocument();
  expect(screen.getByLabelText("Shop name")).toHaveFocus();
  expect(createShop).not.toHaveBeenCalled();
});

it("submits normalized business information and shows the new owner membership", async () => {
  vi.mocked(createShop).mockResolvedValue(result);
  const { user, client } = setup();
  await user.type(screen.getByLabelText("Shop name"), " Café North ");
  await user.type(
    screen.getByLabelText(/Description/),
    " Coffee and pastries ",
  );
  await user.click(screen.getByRole("button", { name: "Create shop" }));
  expect(createShop).toHaveBeenCalledTimes(1);
  expect(vi.mocked(createShop).mock.calls[0][0]).toEqual({
    name: "Café North",
    description: "Coffee and pastries",
  });
  expect(screen.getByText("Your shop was created.")).toBeInTheDocument();
  expect(
    await screen.findByText("Café North is ready. You are its owner."),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Café North", { selector: "strong" }),
  ).toBeInTheDocument();
  expect(client.getQueryData(currentUserKey)).toMatchObject({
    user: { memberships: [result.membership] },
  });
});

it("disables editing and repeat submission while the request is pending", async () => {
  vi.mocked(createShop).mockReturnValue(new Promise(() => {}));
  const { user } = setup();
  await user.type(screen.getByLabelText("Shop name"), "Café North");
  await user.dblClick(screen.getByRole("button", { name: "Create shop" }));
  expect(screen.getByRole("button", { name: "Creating shop…" })).toBeDisabled();
  expect(screen.getByLabelText("Shop name")).toBeDisabled();
  expect(screen.getByLabelText(/Description/)).toBeDisabled();
  expect(createShop).toHaveBeenCalledTimes(1);
});

it("preserves entered information after a failure and allows correction", async () => {
  vi.mocked(createShop).mockRejectedValue(new Error("Server error"));
  const { user } = setup();
  await user.type(screen.getByLabelText("Shop name"), "Café North");
  await user.click(screen.getByRole("button", { name: "Create shop" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "We could not create your shop.",
  );
  expect(screen.getByLabelText("Shop name")).toHaveValue("Café North");
  expect(screen.getByRole("button", { name: "Create shop" })).toBeEnabled();
  expect(createShop).toHaveBeenCalledTimes(1);
});

it("shows server field validation and focuses the invalid field", async () => {
  const error = new AxiosError("Validation failed");
  error.response = {
    status: 400,
    statusText: "Bad Request",
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {
      code: "VALIDATION_ERROR",
      fieldErrors: { name: ["Use a shorter name."] },
    },
  };
  vi.mocked(createShop).mockRejectedValue(error);
  const { user } = setup();
  await user.type(screen.getByLabelText("Shop name"), "Café North");
  await user.click(screen.getByRole("button", { name: "Create shop" }));
  expect(await screen.findByText("Use a shorter name.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText("Shop name")).toHaveFocus());
});

it("can cancel without creating a shop", async () => {
  const { user } = setup();
  await user.click(
    screen.getByRole("link", { name: "Cancel and return to your account" }),
  );
  expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
  expect(createShop).not.toHaveBeenCalled();
});

it.each(["account switch", "logout"])("ignores a late shop response after %s", async (change) => {
  let finish!: (value: CreateShopResponse) => void;
  vi.mocked(createShop).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { user, client } = setup();
  await user.type(screen.getByLabelText("Shop name"), "Cafe North");
  await user.click(screen.getByRole("button", { name: "Create shop" }));
  const nextAccount = { user: { id: "another-user", email: "other@example.com", memberships: [] } };
  act(() => {
    if (change === "logout") client.clear();
    else client.setQueryData(currentUserKey, nextAccount);
  });
  await act(async () => { finish(result); });
  expect(client.getQueryData(currentUserKey)).toEqual(change === "logout" ? undefined : nextAccount);
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
  expect(screen.getByRole("heading", { name: "Create your shop" })).toBeInTheDocument();
});
