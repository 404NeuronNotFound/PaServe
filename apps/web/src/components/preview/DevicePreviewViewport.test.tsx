import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DevicePreviewViewport } from "./DevicePreviewViewport";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["phone", "desktop"] as const)(
  "fits the complete %s device on short and narrow screens and responds to resize",
  (device) => {
    let available = { width: 900, height: 400 };
    const intrinsic =
      device === "phone"
        ? { width: 414, height: 890 }
        : { width: 1032, height: 780 };
    let observeResize!: () => void;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          observeResize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("device-preview-viewport")
          ? available.width
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("device-preview-viewport")
          ? available.height
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("device-preview-model")
          ? intrinsic.width
          : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("device-preview-model")
          ? intrinsic.height
          : 0;
      },
    );
    const { container, unmount } = render(
      <DevicePreviewViewport device={device}>
        <p>Menu</p>
      </DevicePreviewViewport>,
    );
    const model = container.querySelector<HTMLElement>(
      ".device-preview-model",
    )!;
    function scale() {
      return Number(model.style.transform.match(/scale\(([^)]+)\)/)![1]);
    }
    function expectFit() {
      expect(scale()).toBeGreaterThan(0);
      expect(scale()).toBeLessThanOrEqual(1);
      expect(intrinsic.width * scale()).toBeLessThanOrEqual(
        available.width + 0.001,
      );
      expect(intrinsic.height * scale()).toBeLessThanOrEqual(
        available.height + 0.001,
      );
    }
    expectFit();
    available = { width: 220, height: 260 };
    observeResize();
    expectFit();
    available = { width: 1400, height: 1000 };
    fireEvent(window, new Event("resize"));
    expect(scale()).toBe(1);
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  },
);
