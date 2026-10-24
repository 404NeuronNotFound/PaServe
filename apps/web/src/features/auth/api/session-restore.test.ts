// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let cookieVersion: number;
let active: number;
let peak: number;
let valid: boolean;
const user = {
  id: "user",
  email: "owner@example.com",
  firstName: null,
  lastName: null,
  createdAt: "2026-10-08",
  memberships: [],
};

beforeEach(() => {
  cookieVersion = 0;
  active = 0;
  peak = 0;
  valid = true;
  let tail: Promise<unknown> = Promise.resolve();
  vi.stubGlobal("navigator", {
    locks: {
      request: vi.fn((_name: string, operation: () => Promise<unknown>) => {
        const next = tail.then(operation);
        tail = next.catch(() => undefined);
        return next;
      }),
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function tab() {
  // Separate module instances model separate tab/reload memory, sharing one cookie.
  vi.resetModules();
  const session = await import("./session");
  const { api } = await import("../../../lib/api/client");
  const { useSessionStore } = await import("../stores/session");
  vi.spyOn(api, "post").mockImplementation(async (url) => {
    expect(url).toBe("/auth/refresh");
    const sentCookie = cookieVersion;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    if (!valid || sentCookie !== cookieVersion)
      throw new Error("Invalid session");
    cookieVersion++;
    return {
      data: {
        accessToken: `access-${cookieVersion}`,
        user,
        tokenType: "Bearer",
        expiresIn: 900,
      },
    };
  });
  vi.spyOn(api, "get").mockImplementation(async (url, config) => {
    expect(url).toBe("/auth/me");
    expect(config?.headers?.Authorization).toBe(
      `Bearer ${useSessionStore.getState().accessToken}`,
    );
    return { data: { user } };
  });
  expect(useSessionStore.getState().accessToken).toBeNull();
  return { session, api, useSessionStore };
}

it("restores fresh page memory from a surviving session without a password", async () => {
  const first = await tab();
  expect(await first.session.getCurrentUser()).toEqual({ user });
  const reopened = await tab();
  expect(await reopened.session.getCurrentUser()).toEqual({ user });
  expect(cookieVersion).toBe(2);
  expect(reopened.useSessionStore.getState().accessToken).toBe("access-2");
});

it("serializes restoration in two tabs so rotation does not invalidate the session", async () => {
  const first = await tab();
  const second = await tab();
  await Promise.all([
    first.session.getCurrentUser(),
    second.session.getCurrentUser(),
  ]);
  expect(peak).toBe(1);
  expect(cookieVersion).toBe(2);
  expect(first.useSessionStore.getState().accessToken).toBeTruthy();
  expect(second.useSessionStore.getState().accessToken).toBeTruthy();
});

it("deduplicates same-tab refresh and does not restore an expired session", async () => {
  const page = await tab();
  await Promise.all([
    page.session.refreshSession(),
    page.session.refreshSession(),
  ]);
  expect(page.api.post).toHaveBeenCalledTimes(1);
  valid = false;
  await expect(page.session.refreshSession()).rejects.toThrow(
    "Invalid session",
  );
  expect(page.useSessionStore.getState().accessToken).toBeNull();
});

it("releases the cross-tab lock after a failed request so another tab can restore", async () => {
  const first = await tab();
  const second = await tab();
  vi.mocked(first.api.post).mockRejectedValueOnce(new Error("Network error"));
  const results = await Promise.allSettled([first.session.getCurrentUser(), second.session.getCurrentUser()]);
  expect(results[0].status).toBe("rejected");
  expect(results[1]).toEqual({ status: "fulfilled", value: { user } });
});

it("can restore on browsers without Web Locks using the per-tab fallback", async () => {
  vi.stubGlobal("navigator", {});
  const page = await tab();
  expect(await page.session.getCurrentUser()).toEqual({ user });
});
