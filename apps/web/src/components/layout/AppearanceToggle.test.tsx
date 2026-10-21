import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceToggle } from "./AppearanceToggle";
import { useAppearanceStore } from "../../app/stores/appearance";

beforeEach(() => {
  useAppearanceStore.getState().setAppearance("day");
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  useAppearanceStore.getState().setAppearance("day");
  localStorage.clear();
  delete document.documentElement.dataset.appearance;
});

it("switches appearance with the keyboard and preserves the preference across remounts", async () => {
  const user = userEvent.setup();
  const first = render(<AppearanceToggle />);
  const toggle = screen.getByRole("switch", { name: "Dark appearance" });
  expect(toggle).not.toBeChecked();
  toggle.focus();
  await user.keyboard(" ");
  expect(toggle).toBeChecked();
  expect(document.documentElement.dataset.appearance).toBe("night");
  expect(localStorage.getItem("paserve-appearance")).toBe("night");
  first.unmount();
  render(<AppearanceToggle />);
  expect(screen.getByRole("switch")).toBeChecked();
  await user.click(screen.getByRole("switch"));
  expect(document.documentElement.dataset.appearance).toBe("day");
});

it("can change appearance when saving preferences is blocked", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  render(<AppearanceToggle />);
  await userEvent.setup().click(screen.getByRole("switch"));
  expect(screen.getByRole("switch")).toBeChecked();
  expect(document.documentElement.dataset.appearance).toBe("night");
});

it("applies appearance and browser chrome without a mounted toggle", () => {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  document.head.append(meta);
  try {
    useAppearanceStore.getState().setAppearance("night");
    expect(document.documentElement.dataset.appearance).toBe("night");
    expect(meta.content).toBe("#151e18");
    useAppearanceStore.getState().setAppearance("day");
    expect(document.documentElement.dataset.appearance).toBe("day");
    expect(meta.content).toBe("#f5f3ec");
  } finally {
    meta.remove();
  }
});
