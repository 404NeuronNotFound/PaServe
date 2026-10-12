// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it } from "vitest";
import { api } from "../../../lib/api/client";
import { useSessionStore } from "../stores/session";
import { logoutAccount, refreshSession } from "./session";

let server: Server;
let interceptor: number;
let hangLogout: boolean;
let requests: string[];
const originalBase = api.defaults.baseURL;
const originalAdapter = api.defaults.adapter;

beforeEach(async () => {
  requests = [];
  hangLogout = false;
  server = createServer((request, response) => {
    requests.push(request.url ?? "");
    if (request.url === "/auth/logout" && !hangLogout) {
      response.writeHead(204);
      response.end();
    }
    // All other requests deliberately stall to exercise the real HTTP adapter.
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api.defaults.baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  api.defaults.adapter = "http";
  interceptor = api.interceptors.request.use((config) => {
    expect(config.timeout).toBe(15_000);
    // Shorten the configured timeout for this real transport failure test.
    config.timeout = 100;
    return config;
  });
  useSessionStore.getState().setAccessToken("existing-access-token");
});

afterEach(async () => {
  api.interceptors.request.eject(interceptor);
  api.defaults.baseURL = originalBase;
  api.defaults.adapter = originalAdapter;
  useSessionStore.getState().setAccessToken(null);
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

it("continues sign-out after a stalled refresh times out", async () => {
  const refreshing = refreshSession();
  const failedRefresh = expect(refreshing).rejects.toMatchObject({
    code: "ECONNABORTED",
  });
  const loggingOut = logoutAccount();
  await Promise.all([failedRefresh, loggingOut]);
  expect(requests).toEqual(["/auth/refresh", "/auth/logout"]);
  expect(useSessionStore.getState().accessToken).toBeNull();
});

it("does not claim successful revocation after a logout timeout and allows retry", async () => {
  hangLogout = true;
  await expect(logoutAccount()).rejects.toMatchObject({ code: "ECONNABORTED" });
  expect(useSessionStore.getState().accessToken).toBe("existing-access-token");
  hangLogout = false;
  await logoutAccount();
  expect(requests).toEqual(["/auth/logout", "/auth/logout"]);
  expect(useSessionStore.getState().accessToken).toBeNull();
});
