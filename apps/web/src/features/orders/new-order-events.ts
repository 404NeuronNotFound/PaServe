import { api } from "../../lib/api/client";
import { useSessionStore } from "../auth/stores/session";

export type OrderWorkflow = "cashier" | "kitchen";
export type LiveOrderStatus = "connecting" | "live" | "retrying" | "denied";

/** Browser credentials stay in the Authorization header, never in a URL. */
export function subscribeNewOrders(
  shopId: string,
  workflow: OrderWorkflow,
  onRefresh: (isNewOrder: boolean) => void,
  onStatus: (status: LiveOrderStatus) => void,
) {
  return subscribeOrderStream(
    `/shops/${encodeURIComponent(shopId)}/orders/events?workflow=${workflow}`,
    { shopId, workflow },
    "new_order",
    () => useSessionStore.getState().accessToken,
    (event) => onRefresh(event === "new_order"),
    onStatus,
    true,
  );
}

/** Shared authenticated SSE transport; customer credentials never enter staff sessions. */
export function subscribeOrderStream(
  path: string,
  scope: Record<string, string>,
  eventName: "new_order" | "order_confirmed",
  getToken: () => string | null,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  onStatus: (status: LiveOrderStatus) => void,
  staff = false,
) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = staff
    ? useSessionStore.subscribe((state, previous) => {
        if (state.accessToken !== previous.accessToken) controller?.abort();
      })
    : () => {};

  async function connect() {
    if (stopped) return;
    const token = getToken();
    if (!token) {
      onStatus("denied");
      return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    const touch = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => controller?.abort(), 35_000);
    };
    try {
      touch();
      const response = await fetch(
        `${(api.defaults?.baseURL ?? "").replace(/\/$/, "")}${path}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "text/event-stream",
          },
          signal,
          credentials: "include",
        },
      );
      if (stopped || signal.aborted) return;
      if (response.status === 401 && staff) {
        const { refreshSession } = await import("../auth/api/session");
        await refreshSession();
        return;
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 404
      ) {
        stopped = true;
        onStatus("denied");
        if (staff) onEvent("resync", scope);
        return;
      }
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("content-type")?.includes("text/event-stream")
      )
        throw new Error("Order stream unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done || stopped || signal.aborted) break;
          touch();
          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
          if (buffer.length > 65_536) throw new Error("Invalid order stream");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const event = frame
              .split("\n")
              .find((line) => line.startsWith("event: "))
              ?.slice(7);
            const raw = frame
              .split("\n")
              .find((line) => line.startsWith("data: "))
              ?.slice(6);
            if (!raw) continue;
            const data: unknown = JSON.parse(raw);
            if (
              !data ||
              typeof data !== "object" ||
              !Object.entries(scope).every(
                ([key, value]) =>
                  (data as Record<string, unknown>)[key] === value,
              )
            )
              continue;
            if (event === "unavailable") onStatus("retrying");
            if (event === eventName || event === "resync") {
              onStatus("live");
              onEvent(event, data as Record<string, unknown>);
            }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch {
      // Polling/manual refresh remains available while the stream recovers.
    } finally {
      clearTimeout(watchdog);
      controller?.abort();
      if (!stopped) {
        onStatus("retrying");
        timer = setTimeout(() => {
          void connect();
        }, 3_000);
      }
    }
  }
  onStatus("connecting");
  void connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    controller?.abort();
    unsubscribe();
  };
}
