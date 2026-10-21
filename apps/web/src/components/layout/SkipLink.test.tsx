import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkipLink } from "./SkipLink";

afterEach(() => { cleanup(); delete document.documentElement.dataset.appearance; });

it.each(["day", "night"])("bypasses repeated navigation by keyboard in %s without losing input or changing history", async (appearance) => {
  document.documentElement.dataset.appearance = appearance;
  const hash = location.hash;
  const scroll = vi.fn();
  render(<>
    <SkipLink targetId="content">Skip to content</SkipLink>
    <nav aria-label="Repeated navigation"><a href="/menu">Menu</a><a href="/account">Account</a></nav>
    <main id="content" tabIndex={-1}><label>Notes<input defaultValue="No ice" /></label><button>Continue</button></main>
  </>);
  Object.defineProperty(screen.getByRole("main"), "scrollIntoView", { value: scroll });
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("main")).toHaveFocus();
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  await user.tab();
  expect(screen.getByLabelText("Notes")).toHaveFocus();
  expect(screen.getByLabelText("Notes")).toHaveValue("No ice");
  expect(location.hash).toBe(hash);
});
