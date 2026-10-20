import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import { Textarea } from "./textarea";
import { Card, CardHeader, CardTitle, CardContent } from "./card";
import { Table, TableCaption, TableBody, TableRow, TableHead, TableCell } from "./table";
import { Alert, AlertTitle, AlertDescription } from "./alert";
import { PendingButton } from "../feedback/PendingButton";

afterEach(cleanup);

it("requires explicit submit while preserving legacy pending-button form submission", async () => {
  const submit = vi.fn((event) => event.preventDefault());
  render(<form onSubmit={submit}>
    <Button>Preview</Button>
    <Button type="submit">Save</Button>
    <PendingButton pending={false} pendingLabel="Publishing…">Publish</PendingButton>
  </form>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Preview" }));
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "Publish" }));
  expect(submit).toHaveBeenCalledTimes(2);
});
it("composes a real link without nested buttons or a leaked button type", async () => {
  const click = vi.fn((event) => event.preventDefault());
  render(<Button asChild variant="outline"><a href="/menu/cafe" onClick={click}>Menu</a></Button>);
  const link = screen.getByRole("link", { name: "Menu" });
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  expect(link).not.toHaveAttribute("type");
  await userEvent.setup().click(link);
  expect(click).toHaveBeenCalledTimes(1);
});
it("keeps native disabled behavior and forwards the native button ref", async () => {
  const click = vi.fn();
  const ref = createRef<HTMLButtonElement>();
  render(<Button disabled ref={ref} onClick={click}>Delete</Button>);
  expect(ref.current).toBe(screen.getByRole("button", { name: "Delete" }));
  await userEvent.setup().click(ref.current!);
  expect(click).not.toHaveBeenCalled();
});
it("preserves field labels, error descriptions, values and focus refs", async () => {
  const ref = createRef<HTMLInputElement>();
  render(<>
    <Label htmlFor="name">Name</Label>
    <Input id="name" ref={ref} defaultValue="Cafe" aria-invalid aria-describedby="name-error" />
    <p id="name-error">Enter the full name.</p>
    <Label htmlFor="note">Note</Label><Textarea id="note" defaultValue="No ice" />
  </>);
  expect(screen.getByLabelText("Name")).toHaveAccessibleDescription("Enter the full name.");
  expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  ref.current?.focus();
  await userEvent.setup().type(ref.current!, " A");
  expect(ref.current).toHaveValue("Cafe A");
  expect(screen.getByLabelText("Note")).toHaveValue("No ice");
});
it("retains semantic card content and labelled keyboard access to table overflow", () => {
  render(<>
    <Card asChild><article aria-labelledby="card-title"><CardHeader><CardTitle id="card-title">Sales</CardTitle></CardHeader><CardContent>Saved totals</CardContent></article></Card>
    <Table scrollLabel="Daily sales"><TableCaption>Completed orders</TableCaption><TableBody><TableRow><TableHead scope="row">Today</TableHead><TableCell>0</TableCell></TableRow></TableBody></Table>
  </>);
  expect(screen.getByRole("article", { name: "Sales" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Daily sales" })).toHaveAttribute("tabindex", "0");
  expect(screen.getByRole("table", { name: "Completed orders" })).toBeInTheDocument();
  expect(screen.getByRole("rowheader", { name: "Today" })).toHaveAttribute("scope", "row");
});
it("allows feedback to choose polite status without forcing an alert announcement", () => {
  render(<Alert role="status"><AlertTitle>Saved</AlertTitle><AlertDescription>Your settings are saved.</AlertDescription></Alert>);
  expect(screen.getByRole("status")).toHaveTextContent("Your settings are saved.");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
