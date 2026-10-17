import { expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionMatrix } from "./PermissionMatrix";

it("shows the reviewed role boundaries in an accessible read-only matrix", async () => {
  const user = userEvent.setup();
  render(<PermissionMatrix />);
  await user.click(screen.getByText("Permissions by role"));
  const table = screen.getByRole("table", { name: "Shop permissions by role" });
  expect(
    within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent),
  ).toEqual([
    "Capability",
    "Owner",
    "Admin",
    "Manager",
    "Cashier",
    "Kitchen / Barista",
  ]);
  const rowValues = (name: string) =>
    within(within(table).getByRole("row", { name: new RegExp(`^${name} `) }))
      .getAllByRole("cell")
      .map((cell) => cell.textContent);
  expect(rowValues("Manage staff and invitations")).toEqual([
    "Allowed",
    "Denied",
    "Denied",
    "Denied",
    "Denied",
  ]);
  expect(rowValues("Record payments")).toEqual([
    "Allowed",
    "Allowed",
    "Allowed",
    "Allowed",
    "Denied",
  ]);
  expect(rowValues("View preparation queue")).toEqual([
    "Allowed",
    "Allowed",
    "Allowed",
    "Denied",
    "Allowed",
  ]);
  expect(rowValues("Shop administration and tables")).toEqual([
    "Allowed",
    "Allowed",
    "Denied",
    "Denied",
    "Denied",
  ]);
  expect(
    screen.getByText(/Disabled memberships have no shop access/),
  ).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
