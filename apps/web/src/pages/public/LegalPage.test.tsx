import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { LegalPage } from "./LegalPage";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

it.each(["terms", "privacy"] as const)(
  "renders accessible public %s with working contact and document links",
  (kind) => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    render(
      <MemoryRouter>
        <LegalPage kind={kind} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      kind === "terms" ? "Terms of Service" : "Privacy Notice",
    );
    expect(
      screen.getByText(/independently operated by Kevin D. Ramos/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Contact PaServe" }),
    ).toHaveAttribute("href", "mailto:keybeen.webdeveloper@gmail.com");
    expect(
      screen
        .getByRole("navigation", { name: "On this page" })
        .querySelectorAll("a").length,
    ).toBeGreaterThan(5);
    expect(
      screen
        .getByRole("navigation", { name: "Legal documents" })
        .querySelector('[aria-current="page"]'),
    ).toHaveAttribute("href", `/${kind}`);
    expect(screen.getByText(/Version 2026-11-02/)).toBeInTheDocument();
    vi.restoreAllMocks();
  },
);

it("jumps to a clause, updates its reading location and moves keyboard focus", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <LegalPage kind="privacy" />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  const index = screen.getByRole("navigation", { name: "On this page" });
  const link = within(index).getByRole("link", {
    name: "Your choices, rights and requests",
  });
  const section = document.getElementById("rights")!;
  const scroll = vi.fn();
  section.scrollIntoView = scroll;
  await user.click(link);
  expect(scroll).toHaveBeenCalledWith({ block: "start" });
  expect(section).toHaveFocus();
  expect(window.location.hash).toBe("#rights");
  expect(link).toHaveAttribute("aria-current", "location");
});

it("tracks reading position when scrolling and offers print without changing the document", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.tagName === "SECTION")
        return {
          ...rect.call(this),
          top: this.id === "rights" ? 0 : 1000,
        } as DOMRect;
      return rect.call(this);
    },
  );
  render(
    <MemoryRouter>
      <LegalPage kind="privacy" />
    </MemoryRouter>,
  );
  fireEvent.scroll(window);
  await waitFor(() =>
    expect(
      within(
        screen.getByRole("navigation", { name: "On this page" }),
      ).getByRole("link", { name: "Your choices, rights and requests" }),
    ).toHaveAttribute("aria-current", "location"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Print or save PDF" }),
  );
  expect(print).toHaveBeenCalledOnce();
  expect(
    screen.getByRole("article", { name: "Privacy Notice" }),
  ).toBeInTheDocument();
});

it("uses the shared section picker to navigate and supports a deep link on entry", async () => {
  window.history.replaceState(null, "", "/privacy#rights");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(
    <MemoryRouter>
      <LegalPage kind="privacy" />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Jump to a section" }));
  await user.click(
    screen.getByRole("option", { name: "Children and public ordering" }),
  );
  expect(window.location.hash).toBe("#children");
    expect(screen.getByRole("combobox", { name: "Jump to a section" })).toHaveFocus();
});
