import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, describe, beforeEach, afterEach } from "vitest";
import { Button } from "./button";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "./dialog";
import { Sheet, SheetTrigger, SheetContent, SheetTitle, SheetDescription } from "./sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./dropdown-menu";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "./tooltip";

describe.each(["day", "night"] as const)("%s appearance", (appearance) => {

it("keeps a named dialog keyboard accessible and returns focus after dismissal", async () => {
  render(<Dialog><DialogTrigger asChild><Button>Review changes</Button></DialogTrigger>
    <DialogContent><DialogTitle>Review settings</DialogTitle><DialogDescription>Check the changes before saving.</DialogDescription>
      <Button>Save settings</Button></DialogContent></Dialog>);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Review changes" });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog", { name: "Review settings" })).toHaveAccessibleDescription("Check the changes before saving.");
  expect(screen.getByRole("button", { name: "Save settings" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});

it("opens a named sheet by keyboard and restores trigger focus after Escape", async () => {
  render(<Sheet><SheetTrigger asChild><Button>Filters</Button></SheetTrigger>
    <SheetContent><SheetTitle>Order filters</SheetTitle><SheetDescription>Choose which orders to show.</SheetDescription><Button>Apply filters</Button></SheetContent></Sheet>);
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Filters" }).focus();
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("dialog", { name: "Order filters" })).toHaveAccessibleDescription("Choose which orders to show.");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus());
});
it("changes tabs with arrow keys and associates the selected panel", async () => {
  render(<Tabs defaultValue="active"><TabsList aria-label="Orders"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
    <TabsContent value="active">Current orders</TabsContent><TabsContent value="history">Completed orders</TabsContent></Tabs>);
  screen.getByRole("tab", { name: "Active" }).focus();
  await userEvent.setup().keyboard("{ArrowRight}");
  await waitFor(() => expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByRole("tabpanel", { name: "History" })).toHaveTextContent("Completed orders");
});
it("supports dropdown keyboard navigation, skips disabled actions and restores focus", async () => {
  render(<DropdownMenu><DropdownMenuTrigger asChild><Button>Actions</Button></DropdownMenuTrigger>
    <DropdownMenuContent><DropdownMenuItem disabled>Unavailable</DropdownMenuItem><DropdownMenuItem>Edit</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Actions" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(await screen.findByRole("menuitem", { name: "Unavailable" })).toHaveAttribute("aria-disabled", "true");
  await waitFor(() => expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus());
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus());
});
it("exposes tooltip help on keyboard focus without replacing the button name", async () => {
  render(<TooltipProvider delayDuration={0}><Tooltip><TooltipTrigger asChild><Button aria-label="Archive">A</Button></TooltipTrigger><TooltipContent>Keep this item in history</TooltipContent></Tooltip></TooltipProvider>);
  const user = userEvent.setup();
  await user.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Keep this item in history");
  expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
});
it("can keep a floating command menu inside a supplied modal container", async () => {
  const portal = document.createElement("div");
  document.body.append(portal);
  try {
    render(<DropdownMenu><DropdownMenuTrigger asChild><Button>Scoped actions</Button></DropdownMenuTrigger>
      <DropdownMenuContent portalContainer={portal}><DropdownMenuItem>Edit item</DropdownMenuItem></DropdownMenuContent></DropdownMenu>);
    screen.getByRole("button", { name: "Scoped actions" }).focus();
    await userEvent.setup().keyboard("{ArrowDown}");
    expect(portal).toContainElement(await screen.findByRole("menu"));
    await userEvent.setup().keyboard("{Escape}");
  } finally { portal.remove(); }
});

  beforeEach(() => { document.documentElement.dataset.appearance = appearance; });
  afterEach(() => { delete document.documentElement.dataset.appearance; });
});
