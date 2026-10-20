import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { ViewportLayout } from "./ViewportLayout";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function viewport() {
  const view = Object.assign(new EventTarget(), {
    height: 844,
    offsetTop: 0,
    scale: 1,
  });
  vi.stubGlobal("visualViewport", view);
  return view;
}
const root = document.documentElement;
const height = () => root.style.getPropertyValue("--app-viewport-height");

it("follows keyboard opening, panning and closing without remounting page content", () => {
  const view = viewport();
  render(<StrictMode><ViewportLayout /><input defaultValue="Unsaved notes" /></StrictMode>);
  expect(height()).toBe("844px");
  act(() => {
    view.height = 340;
    view.offsetTop = 72;
    view.dispatchEvent(new Event("resize"));
  });
  expect(height()).toBe("340px");
  expect(root).toHaveAttribute("data-short-viewport");
  expect(root.style.getPropertyValue("--app-viewport-top")).toBe("72px");
  act(() => {
    view.offsetTop = 90;
    view.dispatchEvent(new Event("scroll"));
  });
  expect(root.style.getPropertyValue("--app-viewport-top")).toBe("90px");
  act(() => {
    view.height = 844;
    view.offsetTop = 0;
    view.dispatchEvent(new Event("resize"));
  });
  expect(height()).toBe("844px");
  expect(root).not.toHaveAttribute("data-short-viewport");
  expect(document.querySelector("input")).toHaveValue("Unsaved notes");
});

it("keeps native pinch zoom from reflowing the app into a smaller layout", () => {
  const view = viewport();
  render(<ViewportLayout />);
  act(() => {
    view.scale = 2;
    view.height = 422;
    view.offsetTop = 120;
    view.dispatchEvent(new Event("resize"));
  });
  expect(height()).toBe("844px");
  expect(root.style.getPropertyValue("--app-viewport-top")).toBe("0px");
  expect(root).not.toHaveAttribute("data-short-viewport");
});

it("handles orientation changes without VisualViewport and releases listeners on unmount", () => {
  vi.stubGlobal("visualViewport", undefined);
  vi.stubGlobal("innerHeight", 800);
  const { unmount } = render(<ViewportLayout />);
  expect(height()).toBe("800px");
  act(() => {
    vi.stubGlobal("innerHeight", 375);
    window.dispatchEvent(new Event("resize"));
  });
  expect(height()).toBe("375px");
  expect(root).toHaveAttribute("data-short-viewport");
  unmount();
  expect(height()).toBe("");
  act(() => window.dispatchEvent(new Event("resize")));
  expect(height()).toBe("");
  expect(root).not.toHaveAttribute("data-short-viewport");
});

it("removes visual viewport listeners and ignores invalid measurements", () => {
  const view = viewport();
  const { unmount } = render(<ViewportLayout />);
  act(() => {
    view.height = 0;
    view.dispatchEvent(new Event("resize"));
  });
  expect(height()).toBe("844px");
  unmount();
  act(() => {
    view.height = 400;
    view.dispatchEvent(new Event("resize"));
    view.dispatchEvent(new Event("scroll"));
  });
  expect(height()).toBe("");
});
