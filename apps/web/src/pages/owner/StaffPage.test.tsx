import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
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
  setStaffAccess,
} from "../../features/shops/api/staff";

vi.mock("../../features/shops/api/staff", async (original) => ({
  ...(await original<typeof import("../../features/shops/api/staff")>()),
  listStaff: vi.fn(),
  inviteStaff: vi.fn(),
  changeStaffRole: vi.fn(),
  removeStaff: vi.fn(),
  revokeInvitation: vi.fn(),
  setStaffAccess: vi.fn(),
}));
const data: ShopStaffResponse = {
  shopId: "shop-a",
  members: [
    {
      id: "owner-member",
      userId: "owner",
      email: "owner@example.com",
      role: "OWNER",
      isEnabled: true,
      isActive: true,
    },
    {
      id: "staff-member",
      userId: "staff",
      email: "staff@example.com",
      role: "CASHIER",
      isEnabled: true,
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

it("confirms suspension and keeps the member's account and role", async () => {
  vi.mocked(setStaffAccess).mockImplementation(async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...data,
      members: data.members.map((member) =>
        member.id === "staff-member" ? { ...member, isEnabled: false } : member,
      ),
    });
  });
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Disable" }));
  const dialog = screen.getByRole("dialog", { name: "Disable shop access?" });
  expect(dialog).toHaveTextContent(
    /Their account, role, history, and other shop memberships are kept/,
  );
  expect(setStaffAccess).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(setStaffAccess).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Disable" }));
  await user.click(screen.getByRole("button", { name: "Disable access" }));
  expect(setStaffAccess).toHaveBeenCalledExactlyOnceWith(
    "shop-a",
    "staff-member",
    { isEnabled: false },
  );
  expect(
    await screen.findByText("Disabled", { exact: true }),
  ).toBeInTheDocument();
  const team = screen.getByRole("region", { name: "Shop members" });
  expect(within(team).getByText("staff@example.com")).toBeInTheDocument();
  expect(
    within(team).getByText("cashier", { exact: true }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
  expect(removeStaff).not.toHaveBeenCalled();
  expect(changeStaffRole).not.toHaveBeenCalled();
});

it("enables suspended membership without treating account inactivity as shop suspension", async () => {
  const disabledData = {
    ...data,
    members: data.members.map((member) =>
      member.id === "staff-member"
        ? { ...member, isEnabled: false, isActive: false }
        : member,
    ),
  };
  vi.mocked(listStaff).mockResolvedValue(disabledData);
  vi.mocked(setStaffAccess).mockImplementation(async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...disabledData,
      members: disabledData.members.map((member) => ({
        ...member,
        isEnabled: true,
      })),
    });
  });
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Enable" }));
  const dialog = screen.getByRole("dialog", { name: "Enable shop access?" });
  expect(dialog).toHaveTextContent(/Their account must also be active/);
  await user.click(
    within(dialog).getByRole("button", { name: "Enable access" }),
  );
  expect(setStaffAccess).toHaveBeenCalledWith("shop-a", "staff-member", {
    isEnabled: true,
  });
  expect(
    await screen.findByRole("button", { name: "Disable" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/account inactive/)).toBeInTheDocument();
});

it("shows a suspension failure in the dialog and leaves current access displayed", async () => {
  vi.mocked(setStaffAccess).mockRejectedValue(new Error("offline"));
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Disable" }));
  await user.click(screen.getByRole("button", { name: "Disable access" }));
  expect(
    await screen.findByText(/Unable to complete this action/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Disable shop access?" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Disabled", { exact: true }),
  ).not.toBeInTheDocument();
});

it("displays and protects the sole owner without removal or role controls", async () => {
  vi.mocked(listStaff).mockResolvedValue({
    ...data,
    members: [data.members[0]],
  });
  setup();
  const team = await screen.findByRole("region", { name: "Shop members" });
  expect(within(team).getByText("owner@example.com")).toBeInTheDocument();
  const badge = within(team).getByText("Owner", { exact: true });
  expect(badge).toHaveAccessibleDescription(/Owner memberships are protected/);
  expect(within(team).queryByRole("combobox")).not.toBeInTheDocument();
  expect(
    within(team).queryByRole("button", { name: "Disable" }),
  ).not.toBeInTheDocument();
  expect(
    within(team).queryByRole("button", { name: "Enable" }),
  ).not.toBeInTheDocument();
  expect(
    within(team).queryByRole("button", { name: "Remove" }),
  ).not.toBeInTheDocument();
  expect(removeStaff).not.toHaveBeenCalled();
  expect(changeStaffRole).not.toHaveBeenCalled();
});

it("protects another owner as well as the signed-in owner", async () => {
  vi.mocked(listStaff).mockResolvedValue({
    ...data,
    members: [
      ...data.members,
      {
        ...data.members[0],
        id: "second-owner",
        userId: "other",
        email: "other-owner@example.com",
      },
    ],
  });
  setup();
  const team = await screen.findByRole("region", { name: "Shop members" });
  expect(within(team).getAllByText("Owner", { exact: true })).toHaveLength(2);
  expect(
    within(team).queryByLabelText("Role for other-owner@example.com"),
  ).not.toBeInTheDocument();
  expect(within(team).getAllByRole("button", { name: "Remove" })).toHaveLength(
    1,
  );
});

it("does not offer OWNER when inviting staff or changing staff roles", async () => {
  const user = setup();
  for (const name of ["Shop role", "Role for staff@example.com"]) {
    const control = await screen.findByRole("combobox", { name });
    await user.click(control);
    expect(
      screen.queryByRole("option", { name: "Owner" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
  }
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
  await user.click(screen.getByRole("option", { name: "Kitchen / Barista" }));
  expect(
    screen.getByRole("dialog", { name: "Assign kitchen/barista role?" }),
  ).toHaveTextContent(/They will lose counter permissions/);
  expect(changeStaffRole).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole("button", { name: "Assign kitchen/barista" }),
  );
  expect(changeStaffRole).toHaveBeenCalledWith(
    "shop-a",
    "staff-member",
    "KITCHEN",
  );
});

it("explains shared kitchen/barista permissions and confirms before assignment", async () => {
  vi.mocked(changeStaffRole).mockImplementation(async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...data,
      members: data.members.map((member) =>
        member.id === "staff-member" ? { ...member, role: "KITCHEN" } : member,
      ),
    });
  });
  const user = setup();
  const chooseKitchen = async () => {
    await user.click(
      await screen.findByRole("combobox", {
        name: "Role for staff@example.com",
      }),
    );
    await user.click(screen.getByRole("option", { name: "Kitchen / Barista" }));
  };
  await chooseKitchen();
  const dialog = screen.getByRole("dialog", {
    name: "Assign kitchen/barista role?",
  });
  expect(dialog).toHaveAccessibleDescription(
    /staff@example.com will become kitchen\/barista staff in Cafe A/,
  );
  expect(dialog).toHaveTextContent(
    /view the preparation queue and update preparation status/,
  );
  expect(dialog).toHaveTextContent(
    /No order approval, payments, menu or price editing/,
  );
  expect(changeStaffRole).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(changeStaffRole).not.toHaveBeenCalled();
  await chooseKitchen();
  await user.click(
    screen.getByRole("button", { name: "Assign kitchen/barista" }),
  );
  expect(changeStaffRole).toHaveBeenCalledExactlyOnceWith(
    "shop-a",
    "staff-member",
    "KITCHEN",
  );
  expect(
    await within(
      screen.getByRole("region", { name: "Shop members" }),
    ).findByText("kitchen / barista", { exact: true }),
  ).toBeInTheDocument();
  expect(removeStaff).not.toHaveBeenCalled();
});

it("invites a barista using the shared KITCHEN role", async () => {
  vi.mocked(inviteStaff).mockResolvedValue({
    shopId: "shop-a",
    invitation: { ...data.invitations[0], role: "KITCHEN" },
    token: "a".repeat(64),
  });
  const user = setup();
  await user.click(await screen.findByRole("combobox", { name: "Shop role" }));
  await user.click(screen.getByRole("option", { name: "Kitchen / Barista" }));
  await user.type(
    screen.getByLabelText("Staff email address"),
    "barista@example.com",
  );
  await user.click(
    screen.getByRole("button", { name: "Create invitation link" }),
  );
  expect(inviteStaff).toHaveBeenCalledExactlyOnceWith("shop-a", {
    email: "barista@example.com",
    role: "KITCHEN",
  });
  expect(await screen.findByLabelText(/Invitation link/)).toBeInTheDocument();
});

it("finds shared KITCHEN memberships when searching for barista", async () => {
  vi.mocked(listStaff).mockResolvedValue({
    ...data,
    members: data.members.map((member) =>
      member.id === "staff-member" ? { ...member, role: "KITCHEN" } : member,
    ),
  });
  const user = setup();
  await user.type(
    await screen.findByRole("textbox", { name: "Search shop members" }),
    "barista",
  );
  const team = screen.getByRole("region", { name: "Shop members" });
  expect(within(team).getByText("staff@example.com")).toBeInTheDocument();
  expect(within(team).queryByText("owner@example.com")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 member found.");
  expect(changeStaffRole).not.toHaveBeenCalled();
});

it("explains admin permissions and requires confirmation before assignment", async () => {
  vi.mocked(changeStaffRole).mockImplementation(async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...data,
      members: data.members.map((member) =>
        member.id === "staff-member" ? { ...member, role: "ADMIN" } : member,
      ),
    });
  });
  const user = setup();
  const chooseAdmin = async () => {
    await user.click(
      await screen.findByRole("combobox", {
        name: "Role for staff@example.com",
      }),
    );
    await user.click(screen.getByRole("option", { name: "Admin" }));
  };
  await chooseAdmin();
  const dialog = screen.getByRole("dialog", { name: "Assign admin role?" });
  expect(dialog).toHaveAccessibleDescription(
    /staff@example.com will become an admin in Cafe A/,
  );
  expect(dialog).toHaveTextContent(
    /Staff management, settings, ownership, and billing remain owner-only/,
  );
  expect(changeStaffRole).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(changeStaffRole).not.toHaveBeenCalled();
  await chooseAdmin();
  await user.click(screen.getByRole("button", { name: "Assign admin" }));
  expect(changeStaffRole).toHaveBeenCalledExactlyOnceWith(
    "shop-a",
    "staff-member",
    "ADMIN",
  );
  expect(await screen.findByText("admin", { exact: true })).toBeInTheDocument();
  expect(removeStaff).not.toHaveBeenCalled();
});

it.each(["Manager", "Cashier", "Kitchen"])(
  "removes admin authority by assigning %s while retaining membership",
  async (nextRole) => {
    const adminData: ShopStaffResponse = {
      ...data,
      members: data.members.map((member) =>
        member.id === "staff-member" ? { ...member, role: "ADMIN" } : member,
      ),
    };
    vi.mocked(listStaff).mockResolvedValue(adminData);
    const user = setup();
    await user.click(
      await screen.findByRole("combobox", {
        name: "Role for staff@example.com",
      }),
    );
    await user.click(
      screen.getByRole("option", {
        name: nextRole === "Kitchen" ? "Kitchen / Barista" : nextRole,
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name:
        nextRole === "Kitchen"
          ? "Assign kitchen/barista role?"
          : "Remove admin role?",
    });
    expect(dialog).toHaveTextContent(
      /Their membership keeps its current enabled or disabled status/,
    );
    if (nextRole === "Manager")
      expect(dialog).toHaveTextContent(
        /Table management, staff management, settings, ownership, and billing are excluded/,
      );
    if (nextRole === "Cashier")
      expect(dialog).toHaveTextContent(
        /Scan and read orders, confirm or reject orders, record payments/,
      );
    expect(changeStaffRole).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", {
        name:
          nextRole === "Kitchen"
            ? "Assign kitchen/barista"
            : "Remove admin role",
      }),
    );
    expect(changeStaffRole).toHaveBeenCalledWith(
      "shop-a",
      "staff-member",
      nextRole.toUpperCase(),
    );
    expect(removeStaff).not.toHaveBeenCalled();
  },
);

it("explains operational manager access and confirms before assignment", async () => {
  vi.mocked(changeStaffRole).mockImplementation(async () => {
    vi.mocked(listStaff).mockResolvedValue({
      ...data,
      members: data.members.map((member) =>
        member.id === "staff-member" ? { ...member, role: "MANAGER" } : member,
      ),
    });
  });
  const user = setup();
  const chooseManager = async () => {
    await user.click(
      await screen.findByRole("combobox", {
        name: "Role for staff@example.com",
      }),
    );
    await user.click(screen.getByRole("option", { name: "Manager" }));
  };
  await chooseManager();
  const dialog = screen.getByRole("dialog", { name: "Assign manager role?" });
  expect(dialog).toHaveAccessibleDescription(
    /staff@example.com will become a manager in Cafe A/,
  );
  expect(dialog).toHaveTextContent(
    /Daily operations, menu, orders, reports, cashier, and kitchen/,
  );
  expect(dialog).toHaveTextContent(
    /Table management, staff management, settings, ownership, and billing are excluded/,
  );
  expect(changeStaffRole).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(changeStaffRole).not.toHaveBeenCalled();
  await chooseManager();
  await user.click(screen.getByRole("button", { name: "Assign manager" }));
  expect(changeStaffRole).toHaveBeenCalledExactlyOnceWith(
    "shop-a",
    "staff-member",
    "MANAGER",
  );
  expect(
    await screen.findByText("manager", { exact: true }),
  ).toBeInTheDocument();
  expect(removeStaff).not.toHaveBeenCalled();
});

it.each(["Cashier", "Kitchen"])(
  "removes manager authority by assigning %s while retaining membership",
  async (nextRole) => {
    vi.mocked(listStaff).mockResolvedValue({
      ...data,
      members: data.members.map((member) =>
        member.id === "staff-member" ? { ...member, role: "MANAGER" } : member,
      ),
    });
    const user = setup();
    await user.click(
      await screen.findByRole("combobox", {
        name: "Role for staff@example.com",
      }),
    );
    await user.click(
      screen.getByRole("option", {
        name: nextRole === "Kitchen" ? "Kitchen / Barista" : nextRole,
      }),
    );
    const dialog = screen.getByRole("dialog", {
      name:
        nextRole === "Kitchen"
          ? "Assign kitchen/barista role?"
          : "Remove manager role?",
    });
    expect(dialog).toHaveTextContent(
      /Their membership keeps its current enabled or disabled status/,
    );
    expect(changeStaffRole).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", {
        name:
          nextRole === "Kitchen"
            ? "Assign kitchen/barista"
            : "Remove manager role",
      }),
    );
    expect(changeStaffRole).toHaveBeenCalledWith(
      "shop-a",
      "staff-member",
      nextRole.toUpperCase(),
    );
    expect(removeStaff).not.toHaveBeenCalled();
  },
);

it("shows the manager invitation permissions before an invitation is created", async () => {
  const user = setup();
  await user.click(await screen.findByRole("combobox", { name: "Shop role" }));
  await user.click(screen.getByRole("option", { name: "Manager" }));
  expect(
    screen.getByRole("combobox", { name: "Shop role" }),
  ).toHaveAccessibleDescription(
    /Daily operations, menu, orders, reports, cashier, and kitchen/,
  );
  expect(inviteStaff).not.toHaveBeenCalled();
});

it("explains counter permissions and confirms before assigning CASHIER", async () => {
  const kitchenData: ShopStaffResponse = {
    ...data,
    members: data.members.map((member) =>
      member.id === "staff-member" ? { ...member, role: "KITCHEN" } : member,
    ),
  };
  vi.mocked(listStaff).mockResolvedValue(kitchenData);
  vi.mocked(changeStaffRole).mockImplementation(async () => {
    vi.mocked(listStaff).mockResolvedValue(data);
  });
  const user = setup();
  const chooseCashier = async () => {
    await user.click(
      await screen.findByRole("combobox", {
        name: "Role for staff@example.com",
      }),
    );
    await user.click(screen.getByRole("option", { name: "Cashier" }));
  };
  await chooseCashier();
  const dialog = screen.getByRole("dialog", { name: "Assign cashier role?" });
  expect(dialog).toHaveAccessibleDescription(
    /staff@example.com will become a cashier in Cafe A/,
  );
  expect(dialog).toHaveTextContent(
    /Scan and read orders, confirm or reject orders, record payments, and update item availability/,
  );
  expect(dialog).toHaveTextContent(
    /No menu or price editing, reports, kitchen preparation, staff management/,
  );
  expect(changeStaffRole).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(changeStaffRole).not.toHaveBeenCalled();
  await chooseCashier();
  await user.click(screen.getByRole("button", { name: "Assign cashier" }));
  expect(changeStaffRole).toHaveBeenCalledExactlyOnceWith(
    "shop-a",
    "staff-member",
    "CASHIER",
  );
  expect(
    await within(
      screen.getByRole("region", { name: "Shop members" }),
    ).findByText("cashier", { exact: true }),
  ).toBeInTheDocument();
  expect(removeStaff).not.toHaveBeenCalled();
});

it("keeps failed cashier assignment in context without reporting saved access", async () => {
  vi.mocked(listStaff).mockResolvedValue({
    ...data,
    members: data.members.map((member) =>
      member.id === "staff-member" ? { ...member, role: "KITCHEN" } : member,
    ),
  });
  vi.mocked(changeStaffRole).mockRejectedValue(new Error("offline"));
  const user = setup();
  await user.click(
    await screen.findByRole("combobox", { name: "Role for staff@example.com" }),
  );
  await user.click(screen.getByRole("option", { name: "Cashier" }));
  await user.click(screen.getByRole("button", { name: "Assign cashier" }));
  expect(
    await screen.findByText(/Unable to complete this action/),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Assign cashier role?" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("kitchen / barista", { exact: true }),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Shop members" })).queryByText(
      "cashier",
      { exact: true },
    ),
  ).not.toBeInTheDocument();
});
it("filters members by email or role and restores search focus on clear", async () => {
  const user = setup();
  const search = await screen.findByRole("textbox", {
    name: "Search shop members",
  });
  const team = screen.getByRole("region", { name: "Shop members" });
  await user.type(search, "CASHIER");
  expect(within(team).getByText("staff@example.com")).toBeInTheDocument();
  expect(within(team).queryByText("owner@example.com")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("1 member found.");
  await user.click(screen.getByRole("button", { name: "Clear member search" }));
  expect(search).toHaveFocus();
  expect(within(team).getByText("owner@example.com")).toBeInTheDocument();
  await user.type(search, "owner@");
  expect(within(team).queryByText("staff@example.com")).not.toBeInTheDocument();
  expect(changeStaffRole).not.toHaveBeenCalled();
});
it("offers recovery for empty member search without changing the invitation list", async () => {
  const user = setup();
  await user.type(
    await screen.findByRole("textbox", { name: "Search shop members" }),
    "no-match",
  );
  expect(screen.getByText("No members match your search.")).toBeInTheDocument();
  expect(screen.getByText("new@example.com")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show all members" }));
  expect(
    screen.getByRole("textbox", { name: "Search shop members" }),
  ).toHaveValue("");
  expect(screen.getByText("staff@example.com")).toBeInTheDocument();
});
it("shows real team counts and role guidance without granting access", async () => {
  const user = setup();
  const overview = await screen.findByRole("group", { name: "Team overview" });
  expect(overview).toHaveTextContent("2 members");
  expect(overview).toHaveTextContent("1 pending invite");
  expect(
    screen.getByRole("combobox", { name: "Shop role" }),
  ).toHaveAccessibleDescription(
    /Cashier Scan and read orders, confirm or reject orders, record payments, and update item availability/,
  );
  await user.click(screen.getByRole("combobox", { name: "Shop role" }));
  await user.click(screen.getByRole("option", { name: "Kitchen / Barista" }));
  expect(
    screen.getByRole("combobox", { name: "Shop role" }),
  ).toHaveAccessibleDescription(
    /Kitchen \/ Barista Kitchen and barista preparation: view the preparation queue and update preparation status/,
  );
  expect(inviteStaff).not.toHaveBeenCalled();
});

function apiFailure(status: number, code: string, message: string) {
  const error = new AxiosError(message);
  error.response = { status, data: { code, message } } as typeof error.response;
  return error;
}

it.each(["MEMBER_UNAVAILABLE", "INVITATION_UNAVAILABLE"])(
  "refreshes a stale %s target without locking out its owner",
  async (code) => {
    const invitation = code === "INVITATION_UNAVAILABLE";
    const failure = apiFailure(
      404,
      code,
      "The selected record is unavailable.",
    );
    if (invitation) vi.mocked(revokeInvitation).mockRejectedValue(failure);
    else vi.mocked(removeStaff).mockRejectedValue(failure);
    const user = setup();
    await user.click(
      await screen.findByRole("button", {
        name: invitation ? "Revoke invitation" : "Remove",
      }),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: invitation ? "Revoke invitation" : "Remove access",
      }),
    );
    expect(
      await screen.findByText("The selected record is unavailable."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Staff & invitations" }),
    ).toBeInTheDocument();
    expect(listStaff).toHaveBeenCalledTimes(2);
  },
);

it.each([
  [401, "INVALID_SESSION"],
  [403, "OWNER_REQUIRED"],
  [404, "SHOP_NOT_ACCESSIBLE"],
] as const)(
  "still hides staff on real access loss (%s %s)",
  async (status, code) => {
    vi.mocked(removeStaff).mockRejectedValue(
      apiFailure(status, code, "Access lost."),
    );
    const user = setup();
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove access" }));
    expect(
      await screen.findByRole("heading", { name: "Owner access required" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Staff & invitations" }),
    ).not.toBeInTheDocument();
  },
);

it("does not promise to enable a suspended member when changing their role", async () => {
  vi.mocked(listStaff).mockResolvedValue({
    ...data,
    members: data.members.map((member) =>
      member.role === "OWNER" ? member : { ...member, isEnabled: false },
    ),
  });
  const user = setup();
  await user.click(
    await screen.findByRole("combobox", { name: "Role for staff@example.com" }),
  );
  await user.click(screen.getByRole("option", { name: "Kitchen / Barista" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    /keeps its current enabled or disabled status/,
  );
  expect(screen.getByText("Disabled", { exact: true })).toBeInTheDocument();
  expect(setStaffAccess).not.toHaveBeenCalled();
});

it("hides staff when stale-target recovery discovers that the owner also lost access", async () => {
  vi.mocked(removeStaff).mockRejectedValue(
    apiFailure(404, "MEMBER_UNAVAILABLE", "Member removed."),
  );
  vi.mocked(listStaff)
    .mockResolvedValueOnce(data)
    .mockRejectedValueOnce(
      apiFailure(404, "SHOP_NOT_ACCESSIBLE", "Shop unavailable."),
    );
  const user = setup();
  await user.click(await screen.findByRole("button", { name: "Remove" }));
  await user.click(screen.getByRole("button", { name: "Remove access" }));
  expect(
    await screen.findByRole("heading", { name: "Owner access required" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("staff@example.com")).not.toBeInTheDocument();
  expect(listStaff).toHaveBeenCalledTimes(2);
});
