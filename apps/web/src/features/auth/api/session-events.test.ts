import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { announceSignOut, listenForSignOut } from "./session-events";

let channels: FakeChannel[];
let cleanup: (() => void) | undefined;
class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    channels.push(this);
  }
}
beforeEach(() => {
  channels = [];
  localStorage.clear();
  vi.stubGlobal("BroadcastChannel", FakeChannel);
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  localStorage.clear();
});
const event = { type: "signed-out", id: "another-tab" };
it("deduplicates broadcast and storage notices and ignores malformed messages", () => {
  const ended = vi.fn();
  cleanup = listenForSignOut(ended);
  channels[0].onmessage?.(
    new MessageEvent("message", { data: { type: "signed-out", token: "bad" } }),
  );
  channels[0].onmessage?.(new MessageEvent("message", { data: event }));
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "paserve.auth.signed-out",
      newValue: JSON.stringify(event),
    }),
  );
  expect(ended).toHaveBeenCalledTimes(1);
});
it("detects sign-out on resume when a suspended tab missed its events", () => {
  const ended = vi.fn();
  cleanup = listenForSignOut(ended);
  localStorage.setItem("paserve.auth.signed-out", JSON.stringify(event));
  window.dispatchEvent(new Event("focus"));
  window.dispatchEvent(new Event("pageshow"));
  expect(ended).toHaveBeenCalledTimes(1);
});
it("does not treat an old notice or its own sign-out as a remote sign-out", () => {
  localStorage.setItem("paserve.auth.signed-out", JSON.stringify(event));
  const ended = vi.fn();
  cleanup = listenForSignOut(ended);
  window.dispatchEvent(new Event("focus"));
  announceSignOut();
  window.dispatchEvent(new Event("focus"));
  expect(ended).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem("paserve.auth.signed-out")!)).toEqual({
    type: "signed-out",
    id: expect.any(String),
  });
  expect(channels[1].postMessage).toHaveBeenCalledWith({
    type: "signed-out",
    id: expect.any(String),
  });
});
it("supports the storage fallback and removes all listeners on cleanup", () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  const ended = vi.fn();
  cleanup = listenForSignOut(ended);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "paserve.auth.signed-out",
      newValue: JSON.stringify(event),
    }),
  );
  expect(ended).toHaveBeenCalledTimes(1);
  cleanup();
  cleanup = undefined;
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: "paserve.auth.signed-out",
      newValue: JSON.stringify({ ...event, id: "later" }),
    }),
  );
  expect(ended).toHaveBeenCalledTimes(1);
});
