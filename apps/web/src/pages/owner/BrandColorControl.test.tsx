import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BrandColorControl } from "./BrandColorControl";

afterEach(cleanup);
it("selects presets, resets to defaults and locks controls while saving", async () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <BrandColorControl
      kind="accentColor"
      value="#FFFFFF"
      disabled={false}
      onChange={onChange}
    />,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Use Forest for accent color" }),
  );
  expect(onChange).toHaveBeenLastCalledWith("#243329");
  rerender(
    <BrandColorControl
      kind="accentColor"
      value="#243329"
      disabled={false}
      onChange={onChange}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Use Forest for accent color" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Reset accent color" }));
  expect(onChange).toHaveBeenLastCalledWith("");
  rerender(
    <BrandColorControl
      kind="accentColor"
      value=""
      disabled={true}
      onChange={onChange}
    />,
  );
  expect(screen.getByLabelText("Choose accent color")).toBeDisabled();
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
});
