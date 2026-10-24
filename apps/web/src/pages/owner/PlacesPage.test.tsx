import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { currentUserKey } from "../../features/auth/api/session";
import { PlacesPage } from "./PlacesPage";

afterEach(cleanup);
function setup(empty = false) {
  const client = new QueryClient();
  client.setQueryData(currentUserKey, {
    user: {
      id: "user",
      email: "lia@example.com",
      firstName: "Lia",
      lastName: null,
      memberships: empty
        ? []
        : [
            {
              id: "one",
              shopId: "shop-one",
              role: "OWNER",
              shop: { name: "Hapag", slug: "hapag", isActive: true },
            },
            {
              id: "two",
              shopId: "shop-two",
              role: "CASHIER",
              shop: {
                name: "Coffee Corner",
                slug: "coffee-corner",
                isActive: false,
              },
            },
          ],
    },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/app/account/places"]}>
        <PlacesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("shows live memberships and only opens available shops", () => {
  setup();
  expect(screen.getByRole("heading", { name: "Your places" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Your places" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Open Hapag" })).toHaveAttribute(
    "href",
    "/app/shops/shop-one",
  );
  expect(screen.getByText("Inactive shop")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Open Coffee Corner" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Create shop" })).toHaveAttribute(
    "href",
    "/app/onboarding/create-shop",
  );
});
it("searches by role and recovers from no matching places", async () => {
  const user = setup();
  const search = screen.getByRole("searchbox", { name: "Search your places" });
  await user.type(search, "cashier");
  expect(screen.getByRole("heading", { name: "Coffee Corner" })).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Hapag" }),
  ).not.toBeInTheDocument();
  await user.clear(search);
  await user.type(search, "missing");
  expect(
    screen.getByRole("heading", { name: "No places found" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(search).toHaveFocus();
  expect(screen.getByRole("heading", { name: "Hapag" })).toBeVisible();
});
it("explains how to start when there are no memberships", () => {
  setup(true);
  expect(
    screen.getByText(/ask your shop owner for an invitation/),
  ).toBeVisible();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
