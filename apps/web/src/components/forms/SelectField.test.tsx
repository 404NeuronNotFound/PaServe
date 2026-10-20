import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SelectField } from "./SelectField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const onChange = vi.fn();
  render(<SelectField id="role" label="Shop role" value="cashier"
    options={[{ value: "cashier", label: "Cashier" }, { value: "kitchen", label: "Kitchen" }]}
    onChange={onChange} />);
  const trigger = screen.getByRole("combobox");
  vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
    top: 250, bottom: 300, left: 150, right: 450, width: 300, height: 50,
    x: 150, y: 250, toJSON: () => ({}),
  });
  return { onChange, trigger, user: userEvent.setup() };
}

it("keeps open options inside the visible viewport as the keyboard resizes and pans it", async () => {
  const viewport = Object.assign(new EventTarget(), {
    height: 800, width: 390, offsetTop: 0, offsetLeft: 0, scale: 1,
  });
  vi.stubGlobal("visualViewport", viewport);
  const { user, trigger, onChange } = setup();
  await user.click(trigger);
  const panel = screen.getByRole("listbox");
  function expectVisible() {
    const top = parseFloat(panel.style.top);
    const left = parseFloat(panel.style.left);
    expect(top).toBeGreaterThanOrEqual(viewport.offsetTop + 12);
    expect(top + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(viewport.offsetTop + viewport.height - 12);
    expect(left).toBeGreaterThanOrEqual(viewport.offsetLeft + 12);
    expect(left + parseFloat(panel.style.width)).toBeLessThanOrEqual(viewport.offsetLeft + viewport.width - 12);
  }
  expectVisible();
  act(() => {
    viewport.height = 280;
    viewport.offsetTop = 20;
    viewport.dispatchEvent(new Event("resize"));
  });
  expectVisible();
  act(() => {
    viewport.width = 280;
    viewport.height = 160;
    viewport.offsetTop = 100;
    viewport.offsetLeft = 50;
    viewport.dispatchEvent(new Event("scroll"));
  });
  expectVisible();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(onChange).toHaveBeenCalledExactlyOnceWith("kitchen");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

it("fits the layout viewport without VisualViewport and lets Escape return to the form", async () => {
  vi.stubGlobal("visualViewport", undefined);
  vi.stubGlobal("innerWidth", 240);
  vi.stubGlobal("innerHeight", 180);
  const { user, trigger, onChange } = setup();
  await user.click(trigger);
  const panel = screen.getByRole("listbox");
  expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBeLessThanOrEqual(228);
  expect(parseFloat(panel.style.top) + parseFloat(panel.style.maxHeight)).toBeLessThanOrEqual(168);
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
