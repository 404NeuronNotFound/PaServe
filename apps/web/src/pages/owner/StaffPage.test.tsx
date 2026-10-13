import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ShopRole, ShopStaffResponse } from "@paserve/contracts";
import { ActiveShopContext } from "../../features/shops/active-shop";
import { StaffPage } from "./StaffPage";
import {
  changeStaffRole,
  inviteStaff,
  listStaff,
  removeStaff,
  revokeInvitation,
} from "../../features/shops/api/staff";

vi.mock("../../features/shops/api/staff", async (original) => ({
  ...(await original<typeof import("../../features/shops/api/staff")>()),
  listStaff: vi.fn(),
  inviteStaff: vi.fn(),
  changeStaffRole: vi.fn(),
  removeStaff: vi.fn(),
  revokeInvitation: vi.fn(),
}));
const data: ShopStaffResponse = {
  shopId: "shop-a",
  members: [
    {
      id: "owner-member",
      userId: "owner",
      email: "owner@example.com",
      role: "OWNER",
      isActive: true,
    },
    {
      id: "staff-member",
      userId: "staff",
      email: "staff@example.com",
      role: "CASHIER",
      isActive: true,
    },
  ],
  invitations: [
    {
      id: "invite-a",
      email: "new@example.com",
      role: "CASHIER",
      expiresAt: "2026-10-20T00:00:00Z",
      status: "PENDING",
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listStaff).mockResolvedValue(data);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
function setup(role: ShopRole = "OWNER") {
  const client = new QueryClient();
  client.setQueryData(["auth", "me"], { user: { id: "owner" } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ActiveShopContext.Provider
          value={{
            id: "m",
            shopId: "shop-a",
            role,
            shop: {
              id: "shop-a",
              name: "Cafe A",
              slug: "cafe-a",
              isActive: true,
            },
          }}
        >
          <StaffPage />
        </ActiveShopContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it.each(["ADMIN", "MANAGER", "CASHIER", "KITCHEN"] as const)(
  "blocks %s from loading staff",
  async (role) => {
    setup(role);
    expect(
      screen.getByRole("heading", { name: "Owner access required" }),
    ).toBeInTheDocument();
    expect(listStaff).not.toHaveBeenCalled();
  },
);
it("creates a link for a normalized email and defaults to cashier", async () => {
  vi.mocked(inviteStaff).mockResolvedValue({
    shopId: "shop-a",
    invitation: data.invitations[0],
    token: "a".repeat(64),
  });
  const user = setup();
  await user.type(
    await screen.findByLabelText("Staff email address"),
    " New@Example.com ",
  );
  await user.click(
    screen.getByRole("button", { name: "Create invitation link" }),
  );
  expect(inviteStaff).toHaveBeenCalledWith("shop-a", {
    email: "new@example.com",
    role: "CASHIER",
  });
  expect(await screen.findByLabelText(/Invitation link — save it/)).toHaveValue(
    `${window.location.origin}/join/shop-a#token=${"a".repeat(64)}`,
  );
  expect(localStorage.length).toBe(0);
});
it("keeps invalid emails out of the invitation API", async () => {
  const user = setup();
  await screen.findByLabelText("Staff email address");
  await user.click(
    screen.getByRole("button", { name: "Create invitation link" }),
  );
  expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  expect(inviteStaff).not.toHaveBeenCalled();
});

it.each([false, true])(
  "copies a created link with manual fallback when clipboard fails (%s)",
  async (fails) => {
    vi.mocked(inviteStaff).mockResolvedValue({
      shopId: "shop-a",
      invitation: data.invitations[0],
      token: "a".repeat(64),
    });
    const user = setup();
    const write = vi.spyOn(navigator.clipboard, "writeText");
    if (fails) write.mockRejectedValueOnce(new Error("clipboard denied"));
    else write.mockResolvedValueOnce();
    await user.type(
      await screen.findByLabelText("Staff email address"),
      "new@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Create invitation link" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Copy invitation link" }),
    );
    expect(write).toHaveBeenCalledWith(
      `${window.location.origin}/join/shop-a#token=${"a".repeat(64)}`,
    );
    if (fails)
      expect(
        await screen.findByText(/Copy is unavailable/),
      ).toBeInTheDocument();
    expect(screen.getByLabelText(/Invitation link — save it/)).toHaveValue(
      `${window.location.origin}/join/shop-a#token=${"a".repeat(64)}`,
    );
  },
);
it("shows network failure with a working retry", async () => {
  vi.mocked(listStaff)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(data);
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Staff & invitations" }),
  ).toBeInTheDocument();
});
it("requires confirmation before removing staff and preserves the owner", async () => {
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Remove" }));
  expect(removeStaff).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Remove access" }));
  expect(removeStaff).toHaveBeenCalledWith("shop-a", "staff-member");
  expect(
    screen.queryByLabelText("Role for owner@example.com"),
  ).not.toBeInTheDocument();
});
it("confirms and revokes only the selected invitation", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("button", { name: "Revoke invitation" }),
  );
  expect(revokeInvitation).not.toHaveBeenCalled();
  await user.click(
    screen.getAllByRole("button", { name: "Revoke invitation" }).at(-1)!,
  );
  expect(revokeInvitation).toHaveBeenCalledWith("shop-a", "invite-a");
});
it("confirms a role change before saving", async () => {
  const user = setup();
  await user.click(
    await screen.findByRole("combobox", { name: "Role for staff@example.com" }),
  );
  await user.click(screen.getByRole("option", { name: "Kitchen" }));
  expect(changeStaffRole).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Change role" }));
  expect(changeStaffRole).toHaveBeenCalledWith(
    "shop-a",
    "staff-member",
    "KITCHEN",
  );
});
