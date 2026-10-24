import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { api } from "../../../lib/api/client";
import { useSessionStore } from "../stores/session";
import { changePassword, logoutAccount, refreshSession } from "./session";

const adapter = api.defaults.adapter;
let posted: ReturnType<typeof vi.fn>;
beforeEach(() => {
  posted = vi.fn();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage = posted;
      close() {}
    },
  );
  useSessionStore.setState({
    accessToken: "access",
    signedOutElsewhere: false,
  });
});
afterEach(() => {
  api.defaults.adapter = adapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useSessionStore.setState({ accessToken: null, signedOutElsewhere: false });
  localStorage.removeItem("paserve.auth.signed-out");
});
it("does not install a late refresh response after a remote sign-out", async () => {
  let resolve!: (value: unknown) => void;
  vi.spyOn(api, "post").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const refreshing = refreshSession();
  useSessionStore.getState().endSession(true);
  resolve({ data: { accessToken: "late-token" } });
  await expect(refreshing).rejects.toThrow("This session has ended.");
  expect(useSessionStore.getState().accessToken).toBeNull();
});
it("rejects a private response received after invalidation before success callbacks can cache it", async () => {
  let resolve!: (value: AxiosResponse) => void;
  let sent!: InternalAxiosRequestConfig;
  api.defaults.adapter = (config) => {
    sent = config;
    return new Promise((done) => {
      resolve = done;
    });
  };
  const request = api.get("/shops/shop/orders");
  await vi.waitFor(() => expect(sent).toBeDefined());
  useSessionStore.getState().endSession(true);
  resolve({
    data: { private: "orders" },
    status: 200,
    statusText: "OK",
    headers: {},
    config: sent,
  });
  await expect(request).rejects.toThrow("This session has ended.");
});
it("checks invalidation again after waiting for the cross-tab refresh lock", async () => {
  let operation!: () => Promise<unknown>;
  let unlock!: () => void;
  const waiting = new Promise<void>((done) => {
    unlock = done;
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn((_name, callback: () => Promise<unknown>) => {
        operation = callback;
        return waiting.then(operation);
      }),
    },
  });
  const post = vi.spyOn(api, "post");
  const refreshing = refreshSession();
  useSessionStore.getState().endSession(true);
  unlock();
  await expect(refreshing).rejects.toThrow("This session has ended.");
  expect(post).not.toHaveBeenCalled();
});
it("announces sign-out only after successful server revocation", async () => {
  const post = vi
    .spyOn(api, "post")
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({ status: 204 });
  await expect(logoutAccount()).rejects.toThrow("Offline");
  expect(posted).not.toHaveBeenCalled();
  expect(useSessionStore.getState().accessToken).toBe("access");
  await logoutAccount();
  expect(post).toHaveBeenCalledTimes(2);
  expect(posted).toHaveBeenCalledExactlyOnceWith({
    type: "signed-out",
    id: expect.any(String),
  });
  expect(useSessionStore.getState().accessToken).toBeNull();
});
it("also invalidates other tabs after a successful credential change", async () => {
  vi.spyOn(api, "post").mockResolvedValue({ status: 204 });
  await changePassword({
    currentPassword: "current-password",
    password: "new-password-value",
  });
  expect(posted).toHaveBeenCalledExactlyOnceWith({
    type: "signed-out",
    id: expect.any(String),
  });
  expect(useSessionStore.getState().accessToken).toBeNull();
});
