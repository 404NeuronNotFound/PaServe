import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FormField } from "./FormField";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SelectField } from "./SelectField";

afterEach(cleanup);

it("connects labels, hints and errors and clears stale error descriptions", () => {
  const field = (error?: string) => <>
    <p id="extra">Use the saved shop currency.</p>
    <FormField id="price" label="Price" required hint="Two decimal places." error={error}>
      <div><Input id="price" defaultValue="12" aria-describedby="extra price-hint" /></div>
    </FormField>
  </>;
  const view = render(field("Enter an amount."));
  const input = screen.getByLabelText("Price");
  expect(input).toBeRequired();
  expect(input).toBeInvalid();
  expect(input).toHaveAttribute("aria-describedby", "price-hint price-error extra");
  expect(input).toHaveAccessibleDescription("Two decimal places. Enter an amount. Use the saved shop currency.");
  view.rerender(field());
  expect(input).not.toBeInvalid();
  expect(input).toHaveAttribute("aria-describedby", "price-hint extra");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("does not assign the field identity or required state to auxiliary inputs", () => {
  render(<FormField id="brand" label="Brand color" required error="Use a hex color.">
    <Input type="color" aria-label="Choose color" />
    <Input id="brand" />
    <Input id="secondary" aria-label="Secondary" />
  </FormField>);
  expect(screen.getByLabelText("Brand color")).toBeInvalid();
  for (const name of ["Choose color", "Secondary"]) {
    expect(screen.getByLabelText(name)).not.toBeRequired();
    expect(screen.getByLabelText(name)).not.toBeInvalid();
    expect(screen.getByLabelText(name)).not.toHaveAttribute("aria-describedby");
  }
});

it("connects multiline and select controls without replacing their own descriptions", () => {
  render(<>
    <FormField id="notes" label="Notes" hint="For staff." error="Too long.">
      <Textarea id="notes" />
    </FormField>
    <FormField id="role" label="Shop role" required hint="Choose access." error="Choose a role.">
      <SelectField id="role" label="Shop role" value="cashier" onChange={() => {}}
        options={[{ value: "cashier", label: "Cashier" }]} />
    </FormField>
  </>);
  expect(screen.getByLabelText("Notes")).toHaveAccessibleDescription("For staff. Too long.");
  const role = screen.getByRole("combobox");
  expect(role).toHaveAttribute("aria-required", "true");
  expect(role).toHaveAttribute("aria-invalid", "true");
  expect(role).toHaveAttribute("aria-describedby", "role-value role-hint role-error");
});

it("leaves standalone shared controls usable without a field provider", () => {
  render(<Input aria-label="Search" aria-describedby="help" aria-invalid="true" />);
  const input = screen.getByLabelText("Search");
  expect(input).not.toHaveAttribute("id");
  expect(input).not.toBeRequired();
  expect(input).toHaveAttribute("aria-describedby", "help");
  expect(input).toBeInvalid();
});
