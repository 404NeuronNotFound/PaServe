import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import { startPreparing, markReady, completeOrder } from "./queue";

vi.mock("../../lib/api/client", () => ({
  api: {
    post: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
  AUTH_REQUEST_TIMEOUT_MS: 15000,
}));
afterEach(() => vi.resetAllMocks());
const saved = {
  id: "order-a",
  shopId: "shop-a",
  preparationStatus: "PREPARING",
  queuedAt: "2026-10-15T01:00:00.000Z",
  preparationStartedAt: "2026-10-15T01:05:00.000Z",
  preparationStartedBy: "staff-a",
};
it.each([false, true])(
  "returns the validated saved start (already started: %s)",
  async (alreadyStarted) => {
    vi.mocked(api.post).mockResolvedValue({
      data: { order: saved, alreadyStarted },
    });
    expect(await startPreparing("shop-a", "order-a")).toEqual({
      order: saved,
      alreadyStarted,
    });
  },
);
it.each([
  { shopId: "foreign" },
  { id: "foreign" },
  { preparationStatus: "QUEUED" },
  { preparationStartedAt: "invalid" },
  { preparationStartedAt: "2020-01-01T00:00:00.000Z" },
  { preparationStartedBy: null },
  { queuedAt: 2000 },
])("rejects unverified preparation starts: %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...saved, ...change }, alreadyStarted: false },
  });
  await expect(startPreparing("shop-a", "order-a")).rejects.toThrow(
    "could not be verified",
  );
});
const ready = {
  ...saved,
  preparationStatus: "READY",
  preparationReadyAt: "2026-10-15T01:15:00.000Z",
  preparationReadyBy: "staff-b",
};
const completed = {
  ...ready,
  preparationStatus: "COMPLETED",
  completedAt: "2026-10-15T01:20:00.000Z",
  completedBy: "staff-c",
};
it.each([false, true])(
  "validates original completion (already completed: %s)",
  async (alreadyCompleted) => {
    vi.mocked(api.post).mockResolvedValue({
      data: { order: completed, alreadyCompleted },
    });
    expect(await completeOrder("shop-a", "order-a")).toEqual({
      order: completed,
      alreadyCompleted,
    });
  },
);
it.each([
  { shopId: "foreign" },
  { id: "foreign" },
  { preparationStatus: "READY" },
  { completedAt: "invalid" },
  { completedAt: "2020-01-01T00:00:00.000Z" },
  { completedBy: null },
  { preparationReadyAt: null },
])("rejects unverified completion receipts %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...completed, ...change }, alreadyCompleted: false },
  });
  await expect(completeOrder("shop-a", "order-a")).rejects.toThrow(
    "could not be verified",
  );
});
it.each([false, true])(
  "validates saved readiness (already ready: %s)",
  async (alreadyReady) => {
    vi.mocked(api.post).mockResolvedValue({
      data: { order: ready, alreadyReady },
    });
    expect(await markReady("shop-a", "order-a")).toEqual({
      order: ready,
      alreadyReady,
    });
  },
);
it.each([
  { id: "foreign" },
  { shopId: "foreign" },
  { preparationStatus: "PREPARING" },
  { preparationReadyAt: "invalid" },
  { preparationReadyAt: "2020-01-01T00:00:00.000Z" },
  { preparationStartedAt: null },
  { preparationReadyBy: "" },
])("rejects unverified ready receipts %j", async (change) => {
  vi.mocked(api.post).mockResolvedValue({
    data: { order: { ...ready, ...change }, alreadyReady: false },
  });
  await expect(markReady("shop-a", "order-a")).rejects.toThrow(
    "could not be verified",
  );
});
