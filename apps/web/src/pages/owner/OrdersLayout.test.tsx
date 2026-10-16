import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { UserMembership } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { OrdersLayout } from "./OrdersLayout";

afterEach(cleanup);
function setup(role: UserMembership["role"] = "OWNER") {
  render(
    <ActiveShopContext.Provider
      value={{
        id: "member",
        shopId: "a",
        role,
        shop: { id: "a", name: "Cafe", slug: "cafe", isActive: true },
      }}
    >
      <MemoryRouter initialEntries={["/app/shops/a/orders"]}>
        <Routes>
          <Route path="/app/shops/a/orders" element={<OrdersLayout />}>
            <Route index element={<h1>Active content</h1>} />
            <Route path="completed" element={<h1>Completed content</h1>} />
            <Route path="cancelled" element={<h1>Rejected content</h1>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ActiveShopContext.Provider>,
  );
}
it("navigates between owner order views with the correct current link", () => {
  setup();
  expect(screen.getByRole("link", { name: "Active orders" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("link", { name: "Completed orders" }));
  expect(
    screen.getByRole("heading", { name: "Completed content" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Completed orders" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.getByRole("link", { name: "Active orders" }),
  ).not.toHaveAttribute("aria-current");
  fireEvent.click(screen.getByRole("link", { name: "Cancelled / rejected" }));
  expect(
    screen.getByRole("heading", { name: "Rejected content" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Cancelled / rejected" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.getByRole("link", { name: "Completed orders" }),
  ).not.toHaveAttribute("aria-current");
});
it("withholds owner navigation for other roles", () => {
  setup("MANAGER");
  expect(
    screen.queryByRole("navigation", { name: "Order views" }),
  ).not.toBeInTheDocument();
});
