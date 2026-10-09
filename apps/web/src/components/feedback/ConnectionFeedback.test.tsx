import { afterEach, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { ConnectionFeedback } from "./ConnectionFeedback";
import { useFeedbackStore } from "../../app/stores/feedback";

afterEach(() => useFeedbackStore.getState().clear());
it("shows a persistent offline warning and a brief recovery update", () => {
  render(<ConnectionFeedback />);
  expect(useFeedbackStore.getState().banners).toHaveLength(0);
  act(() => window.dispatchEvent(new Event("offline")));
  expect(useFeedbackStore.getState().banners).toEqual([
    expect.objectContaining({ key: "connection-offline", tone: "warning" }),
  ]);
  act(() => window.dispatchEvent(new Event("online")));
  expect(useFeedbackStore.getState().banners).toHaveLength(0);
  expect(useFeedbackStore.getState().notices).toEqual([
    expect.objectContaining({
      kind: "toast",
      message: "You’re back online.",
      duration: 3000,
    }),
  ]);
});
it("does not fabricate a notice on an ordinary online event", () => {
  render(<ConnectionFeedback />);
  act(() => window.dispatchEvent(new Event("online")));
  expect(useFeedbackStore.getState().notices).toHaveLength(0);
});
