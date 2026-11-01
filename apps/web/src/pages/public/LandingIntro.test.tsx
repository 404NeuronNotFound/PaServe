import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LandingIntro } from "./LandingIntro";

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.setAttribute("open", ""); }) });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.removeAttribute("open"); }) });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close;
});

it("hands the seal to measured navigation geometry and restores the real mark on skip", () => {
  const previous = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    if (this.classList.contains("intro-seal")) return { left: 400, top: 220, width: 88, height: 88 } as DOMRect;
    if (this.classList.contains("brand-symbol")) return { left: 32, top: 24, width: 40, height: 40 } as DOMRect;
    return previous.call(this);
  });
  render(<div className="landing-page"><a className="landing-brand"><span className="brand-symbol"><svg /></span></a><LandingIntro /></div>);
  act(() => vi.advanceTimersByTime(1800));
  const intro = screen.getByRole("dialog");
  expect(intro).toHaveAttribute("data-flight-ready", "true");
  expect(intro.style.getPropertyValue("--flight-x")).toBe("-392px");
  expect(intro.style.getPropertyValue("--flight-y")).toBe("-220px");
  expect(document.querySelector(".landing-page")).toHaveAttribute("data-intro-flight", "true");
  fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
  expect(document.querySelector(".landing-page")).not.toHaveAttribute("data-intro-flight");
  expect(vi.getTimerCount()).toBe(0);
});

it("opens once per tab session and releases the page after its finite opening", () => {
  render(<LandingIntro />);
  expect(screen.getByRole("dialog", { name: "Welcome to PaServe" })).toBeInTheDocument();
  expect(document.body.style.overflow).toBe("hidden");
  act(() => vi.advanceTimersByTime(3500));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");
  cleanup();
  render(<LandingIntro />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("can be skipped immediately and restores the page focus", () => {
  render(<><main id="landing-main" tabIndex={-1} /><LandingIntro /></>);
  fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.getElementById("landing-main")).toHaveFocus();
  expect(document.body.style.overflow).toBe("");
});

it("bypasses the intro for reduced motion and unsupported dialog browsers", () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
  render(<LandingIntro />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  cleanup();
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false } as MediaQueryList);
  delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  render(<LandingIntro />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("releases the scroll lock and timer when unmounted early", () => {
  document.body.style.overflow = "auto";
  const view = render(<LandingIntro />);
  view.unmount();
  expect(document.body.style.overflow).toBe("auto");
  expect(vi.getTimerCount()).toBe(0);
  document.body.style.overflow = "";
});

it("dismisses the opening on Escape without waiting for animation completion", () => {
  render(<LandingIntro />);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");
  expect(vi.getTimerCount()).toBe(0);
});
