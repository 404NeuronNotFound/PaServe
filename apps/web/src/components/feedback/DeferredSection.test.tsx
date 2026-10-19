import { lazy } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DeferredSection } from "./DeferredSection";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function observers() {
  const callbacks: IntersectionObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  return {
    show: (index: number) =>
      act(() =>
        callbacks[index](
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      ),
    disconnect,
  };
}

it("keeps off-screen work unmounted, starts sections independently and keeps them mounted", () => {
  const observer = observers();
  const first = vi.fn(() => <p>First report</p>);
  const second = vi.fn(() => <p>Second report</p>);
  const First = first,
    Second = second;
  const { rerender } = render(
    <>
      <DeferredSection label="first" placeholder={<p>First placeholder</p>}>
        <First />
      </DeferredSection>
      <DeferredSection label="second" placeholder={<p>Second placeholder</p>}>
        <Second />
      </DeferredSection>
    </>,
  );
  expect(first).not.toHaveBeenCalled();
  expect(second).not.toHaveBeenCalled();
  observer.show(1);
  expect(screen.getByText("Second report")).toBeVisible();
  expect(first).not.toHaveBeenCalled();
  expect(observer.disconnect).toHaveBeenCalled();
  observer.show(0);
  expect(screen.getByText("First report")).toBeVisible();
  rerender(
    <>
      <DeferredSection label="first" placeholder={<p>First placeholder</p>}>
        <First />
      </DeferredSection>
      <DeferredSection label="second" placeholder={<p>Second placeholder</p>}>
        <Second />
      </DeferredSection>
    </>,
  );
  expect(screen.queryByText("First placeholder")).not.toBeInTheDocument();
});

it("lets keyboard users load a section and keeps focus in its stable region", () => {
  observers();
  render(
    <DeferredSection label="report" placeholder={<p>Waiting</p>}>
      <h2>Report</h2>
    </DeferredSection>,
  );
  const button = screen.getByRole("button", { name: "Load report" });
  button.focus();
  fireEvent.click(button);
  expect(
    screen.getByRole("heading", { name: "Report" }).parentElement,
  ).toHaveFocus();
});

it("loads normally when observation is unsupported or broken", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { unmount } = render(
    <DeferredSection label="report" placeholder="Waiting">
      <p>Report</p>
    </DeferredSection>,
  );
  expect(screen.getByText("Report")).toBeVisible();
  unmount();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor() {
        throw new Error("unsupported");
      }
    },
  );
  render(
    <DeferredSection label="report" placeholder="Waiting">
      <p>Recovered report</p>
    </DeferredSection>,
  );
  expect(await screen.findByText("Recovered report")).toBeVisible();
});

it("isolates a pending module and its failure from other sections", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
  let reject!: (error: Error) => void;
  const Slow = lazy(
    () =>
      new Promise<{ default: () => React.ReactNode }>((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(
    <>
      <h1>Sales summary</h1>
      <DeferredSection
        label="slow report"
        placeholder={<p>Preparing report</p>}
      >
        <Slow />
      </DeferredSection>
      <DeferredSection label="ready report" placeholder="Waiting">
        <h2>Ready report</h2>
      </DeferredSection>
    </>,
  );
  expect(screen.getByRole("heading", { name: "Sales summary" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Ready report" })).toBeVisible();
  expect(screen.getByText("Preparing report")).toBeVisible();
  await act(async () => reject(new Error("Chunk unavailable")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "couldn’t load slow report",
  );
  expect(screen.getByRole("heading", { name: "Ready report" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload page" })).toBeEnabled();
});
