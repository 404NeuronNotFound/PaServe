import {
  render,
  screen,
  within,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, afterEach, vi } from "vitest";
import { LandingPage } from "./LandingPage";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
  return userEvent.setup();
}
it("provides working account CTAs and direct links to the page sections", () => {
  setup();
  expect(
    screen.getByRole("link", { name: /Set up your shop/ }),
  ).toHaveAttribute("href", "/register");
  expect(
    screen.getByRole("link", { name: /Create your PaServe account/ }),
  ).toHaveAttribute("href", "/register");
  for (const name of ["The flow", "Your team", "Questions"]) {
    const link = within(
      screen.getByRole("navigation", { name: "Explore PaServe" }),
    ).getByRole("link", { name });
    expect(
      document.querySelector(link.getAttribute("href")!),
    ).toBeInTheDocument();
  }
});
it("lets visitors follow a sample handoff without creating a real order", async () => {
  const actor = setup();
  const group = screen.getByRole("group", { name: "Follow a sample order" });
  expect(
    within(group).getByRole("button", { name: /Customer/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await actor.click(within(group).getByRole("button", { name: /Cashier/ }));
  expect(
    document.getElementById("landing-handoff-description"),
  ).toHaveTextContent("confirm and record payment together");
  await actor.click(within(group).getByRole("button", { name: /Kitchen/ }));
  expect(
    document.getElementById("landing-handoff-description"),
  ).toHaveTextContent("mark ready");
  expect(
    within(group).getByRole("button", { name: /Kitchen/ }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(document.querySelector(".landing-counter-scene")).toHaveAttribute(
    "data-phase",
    "2",
  );
});
it("supports keyboard navigation between role previews", async () => {
  const actor = setup();
  const owner = screen.getByRole("tab", { name: "Owner" });
  owner.focus();
  await actor.keyboard("{End}{Enter}");
  expect(screen.getByRole("tab", { name: "Kitchen" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("tabpanel")).toHaveTextContent(
    "Less guessing. More making.",
  );
  expect(screen.getByRole("tabpanel")).not.toHaveTextContent(
    "Team invitations and roles",
  );
});
it("answers customer-account questions using a native disclosure", async () => {
  const actor = setup();
  const question = screen.getByText("Do customers need a PaServe account?");
  await actor.click(question);
  expect(question.closest("details")).toHaveAttribute("open");
  expect(question.closest("details")).toHaveTextContent(
    "without creating a staff account",
  );
});

it("keeps role previews aligned with the existing management boundaries", async () => {
  const actor = setup();
  await actor.click(screen.getByRole("tab", { name: "Admin" }));
  let panel = screen.getByRole("tabpanel");
  expect(
    within(panel).getByText("Tables", { exact: true }),
  ).toBeInTheDocument();
  expect(panel).not.toHaveTextContent("Staff & invitations");
  expect(panel).not.toHaveTextContent("Shop settings");
  await actor.click(screen.getByRole("tab", { name: "Manager" }));
  panel = screen.getByRole("tabpanel");
  expect(
    within(panel).getByText("Cashier", { exact: true }),
  ).toBeInTheDocument();
  expect(panel).not.toHaveTextContent("Tables");
  expect(panel).not.toHaveTextContent("Staff & invitations");
});

it("links the developer credit to the supplied portfolio and identifies Codex as the AI agent", () => {
  setup();
  const footer = screen.getByRole("contentinfo");
  const portfolio = within(footer).getByRole("link", {
    name: /404NeuronNotFound portfolio/,
  });
  expect(portfolio).toHaveAttribute(
    "href",
    "https://keybeen-fullstack-developer.vercel.app",
  );
  expect(portfolio).toHaveAttribute("rel", "noopener noreferrer");
  expect(footer).toHaveTextContent("With Codex, an AI coding agent.");
  expect(
    within(footer).getByRole("link", { name: "Back to top" }),
  ).toHaveAttribute("href", "#landing-main");
});

function scrollFixture(reduced = false) {
  let offset = 0;
  const media = {
    matches: reduced,
    addEventListener: vi.fn<(type: string, callback: () => void) => void>(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      let top: number;
      let height: number;
      if (this.matches(".landing-scroll-story")) {
        top = 800 - offset;
        height = 1500;
      } else if (this.hasAttribute("data-service-chapter")) {
        top = 800 + Number(this.dataset.serviceChapter) * 500 - offset;
        height = 500;
      } else return original.call(this);
      return {
        top,
        bottom: top + height,
        left: 0,
        right: 500,
        width: 500,
        height,
        x: 0,
        y: top,
        toJSON() {},
      } as DOMRect;
    },
  );
  return {
    media,
    move: (value: number) => {
      offset = value;
      fireEvent.scroll(window);
    },
  };
}
it("advances the sticky preview when scrolling through the real chapter positions", async () => {
  const fixture = scrollFixture();
  setup();
  const group = screen.getByRole("group", { name: "Choose a service stage" });
  await waitFor(() =>
    expect(
      document
        .querySelector<HTMLElement>(".landing-page")
        ?.style.getPropertyValue("--hero-lift"),
    ).toBe("0.00px"),
  );
  fixture.move(1200);
  await waitFor(() =>
    expect(
      within(group).getByRole("button", { name: "Cashier" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  expect(document.querySelector(".landing-story-status")).toHaveTextContent(
    "In the preparation queue",
  );
  expect(document.querySelector(".landing-board-insight")).toHaveTextContent("REVIEWED AT THE COUNTER");
  fixture.move(1700);
  await waitFor(() =>
    expect(
      within(group).getByRole("button", { name: "Kitchen" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  fixture.move(600);
  await waitFor(() =>
    expect(
      within(group).getByRole("button", { name: "Customer" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
});
it("keeps scroll stages functional with reduced motion and disconnects preference listeners", async () => {
  const fixture = scrollFixture(true);
  setup();
  fixture.move(1200);
  await waitFor(() =>
    expect(document.querySelector(".landing-scroll-story")).toHaveAttribute(
      "data-chapter",
      "1",
    ),
  );
  expect(
    document
      .querySelector<HTMLElement>(".landing-page")
      ?.style.getPropertyValue("--hero-turn"),
  ).toBe("0deg");
  expect(
    document
      .querySelector<HTMLElement>(".landing-page")
      ?.style.getPropertyValue("--hero-lift"),
  ).toBe("0px");
  cleanup();
  expect(fixture.media.removeEventListener).toHaveBeenCalledWith(
    "change",
    expect.any(Function),
  );
});
it("cancels an in-progress entrance when reduced motion is enabled", async () => {
  const fixture = scrollFixture();
  let reveal: IntersectionObserverCallback;
  const disconnect = vi.fn(),
    unobserve = vi.fn(),
    cancel = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        reveal = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
      unobserve = unobserve;
    },
  );
  const animate = vi.fn(() => ({ cancel, addEventListener: vi.fn() }));
  const originalAnimate = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  try {
    setup();
    const target = document.querySelector("[data-reveal]")!;
    reveal!(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(animate).toHaveBeenCalled();
    fixture.media.matches = true;
    fixture.media.addEventListener.mock.calls[0][1]();
    expect(cancel).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalled();
  } finally {
    if (originalAnimate)
      Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});

function footerFixture(reduced = false) {
  const previous = HTMLElement.prototype.getBoundingClientRect;
  const fixture = scrollFixture(reduced);
  let position = 0;
  vi.stubGlobal("innerHeight", 1000);
  vi.stubGlobal("scrollY", 0);
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => position,
  });
  vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(
    6000,
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (!this.matches(".landing-footer")) return previous.call(this);
      const top = 5000 - position;
      return {
        top,
        bottom: top + 1000,
        left: 0,
        right: 1200,
        width: 1200,
        height: 1000,
        x: 0,
        y: top,
        toJSON() {},
      } as DOMRect;
    },
  );
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "animate",
  );
  const animate = vi.fn(
    (frames: Keyframe[], options: KeyframeAnimationOptions) => ({
      frames,
      options,
      cancel: vi.fn(),
      addEventListener: vi.fn(),
    }),
  );
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: animate,
  });
  return {
    ...fixture,
    animate,
    go: (value: number) => {
      position = value;
      fixture.move(value);
    },
    restore: () => {
      if (original)
        Object.defineProperty(HTMLElement.prototype, "animate", original);
      else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
    },
  };
}
it("replays the 3D footer impression after leaving the bottom and returning, without bounce loops", async () => {
  const fixture = footerFixture();
  try {
    setup();
    const footer = screen.getByRole("contentinfo");
    fixture.go(4970);
    await waitFor(() =>
      expect(footer).toHaveAttribute("data-footer-visit", "1"),
    );
    const count = fixture.animate.mock.calls.length;
    expect(count).toBe(10); // Eight glyphs, one reflection, one rule.
    expect(fixture.animate.mock.results[0].value.frames[0].transform).toContain(
      "rotateY",
    );
    expect(
      fixture.animate.mock.results[0].value.frames[0].transform,
    ).not.toContain("translateY");
    fixture.go(5020);
    await waitFor(() =>
      expect(
        document
          .querySelector<HTMLElement>(".landing-page")
          ?.style.getPropertyValue("--reading-progress"),
      ).toBe("1"),
    );
    expect(fixture.animate).toHaveBeenCalledTimes(count);
    fixture.go(4500);
    await waitFor(() =>
      expect(
        document
          .querySelector<HTMLElement>(".landing-page")
          ?.style.getPropertyValue("--reading-progress"),
      ).toBe("0.9"),
    );
    fixture.go(4970);
    await waitFor(() =>
      expect(footer).toHaveAttribute("data-footer-visit", "2"),
    );
    expect(fixture.animate).toHaveBeenCalledTimes(count * 2);
    expect(
      within(footer).getByRole("link", { name: /404NeuronNotFound portfolio/ }),
    ).toBeVisible();
  } finally {
    fixture.restore();
  }
});
it("keeps the footer still with reduced motion, while retaining all navigation", async () => {
  const fixture = footerFixture(true);
  try {
    setup();
    fixture.go(4970);
    await waitFor(() =>
      expect(
        document
          .querySelector<HTMLElement>(".landing-page")
          ?.style.getPropertyValue("--reading-progress"),
      ).toBe("0.994"),
    );
    expect(fixture.animate).not.toHaveBeenCalled();
    expect(screen.getByRole("contentinfo")).not.toHaveAttribute(
      "data-footer-visit",
    );
    expect(
      within(screen.getByRole("contentinfo")).getByRole("link", {
        name: "Back to top",
      }),
    ).toHaveAttribute("href", "#landing-main");
  } finally {
    fixture.restore();
  }
});
it("cancels every active footer layer when the user changes their motion preference", async () => {
  const fixture = footerFixture();
  try {
    setup();
    fixture.go(4970);
    await waitFor(() =>
      expect(screen.getByRole("contentinfo")).toHaveAttribute(
        "data-footer-visit",
        "1",
      ),
    );
    fixture.media.matches = true;
    fixture.media.addEventListener.mock.calls[0][1]();
    fixture.animate.mock.results.forEach((result) =>
      expect(result.value.cancel).toHaveBeenCalled(),
    );
    expect(
      within(screen.getByRole("contentinfo")).getByRole("link", {
        name: /404NeuronNotFound portfolio/,
      }),
    ).toBeVisible();
  } finally {
    fixture.restore();
  }
});

it("pivots a changed handoff in place and cancels the turn on unmount", async () => {
  const fixture = footerFixture();
  try {
    const actor = setup();
    const group = screen.getByRole("group", { name: "Follow a sample order" });
    await actor.click(within(group).getByRole("button", { name: /Cashier/ }));
    expect(
      document.getElementById("landing-handoff-description"),
    ).toHaveTextContent("confirm and record payment together");
    expect(fixture.animate).toHaveBeenCalledOnce();
    const motion = fixture.animate.mock.results[0].value;
    expect(motion.frames[0].transform).toContain("rotateY");
    expect(motion.frames[0].transform).not.toContain("translateY");
    cleanup();
    expect(motion.cancel).toHaveBeenCalled();
  } finally {
    fixture.restore();
  }
});

it("observes new role panels and keeps one timeline per visible element", async () => {
  scrollFixture();
  let reveal: IntersectionObserverCallback;
  const observe = vi.fn();
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { reveal = callback; }
    observe = observe;
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
  const animate = vi.fn(() => ({ cancel: vi.fn(), addEventListener: vi.fn() }));
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  try {
    const actor = setup();
    const target = document.querySelector(".landing-faq-list details")!;
    expect(observe).toHaveBeenCalledWith(target);
    expect(observe).toHaveBeenCalledWith(document.querySelector(".colophon-maker"));
    const entry = [{ isIntersecting: true, target } as IntersectionObserverEntry];
    reveal!(entry, {} as IntersectionObserver);
    const count = animate.mock.calls.length;
    reveal!(entry, {} as IntersectionObserver);
    expect(animate).toHaveBeenCalledTimes(count);
    const timeline = animate.mock.results.at(-1)!.value;
    reveal!([{ isIntersecting: false, target } as IntersectionObserverEntry], {} as IntersectionObserver);
    expect(timeline.cancel).toHaveBeenCalledOnce();
    reveal!(entry, {} as IntersectionObserver);
    expect(animate).toHaveBeenCalledTimes(count + 1);
    await actor.click(screen.getByRole("tab", { name: "Cashier" }));
    await waitFor(() => expect(observe).toHaveBeenCalledWith(document.querySelector(".landing-workspace-sample")));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Confirm and pay");
  } finally {
    if (original) Object.defineProperty(HTMLElement.prototype, "animate", original);
    else delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});
