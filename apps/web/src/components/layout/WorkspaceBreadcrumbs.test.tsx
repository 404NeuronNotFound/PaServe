import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import type { UserMembership } from "@paserve/contracts";
import { WorkspaceBreadcrumbs } from "./WorkspaceBreadcrumbs";

afterEach(cleanup);
const membership: UserMembership = {
  id: "member-a", shopId: "a", role: "OWNER",
  shop: { id: "a", name: "Cafe A", slug: "cafe-a", isActive: true },
};
function setup(path: string, member: UserMembership | null = membership) {
  render(<MemoryRouter initialEntries={[path]}><WorkspaceBreadcrumbs membership={member} /></MemoryRouter>);
}
it.each([
  ["orders/completed", "Completed orders", "Orders", "orders"],
  ["orders/cancelled", "Cancelled / rejected", "Orders", "orders"],
  ["orders/order-a", "Order details", "Orders", "orders"],
  ["products/latte/customize", "Product customization", "Products", "products"],
])("provides a parent destination and exact current page for %s", (path, current, parent, parentPath) => {
  setup(`/app/shops/a/${path}`);
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  expect(within(nav).getByText(current)).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByRole("link", { name: parent })).toHaveAttribute("href", `/app/shops/a/${parentPath}`);
  expect(nav.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(nav).toHaveTextContent("Cafe A · owner");
});
it.each(["CASHIER", "KITCHEN"] as const)("hides owner-only breadcrumb destinations from %s", (role) => {
  setup("/app/shops/a/settings", { ...membership, role });
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
it("does not expose shop navigation while membership is unavailable", () => {
  setup("/app/shops/a/settings", null);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
it("does not confuse a different shop's route with the active shop", () => {
  setup("/app/shops/another/settings");
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
it("updates the location trail when returning from a nested page to its parent", async () => {
  setup("/app/shops/a/products/latte/customize");
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  await userEvent.setup().click(within(nav).getByRole("link", { name: "Products" }));
  expect(within(nav).queryByText("Product customization")).not.toBeInTheDocument();
  expect(within(nav).getByText("Products")).toHaveAttribute("aria-current", "page");
});
