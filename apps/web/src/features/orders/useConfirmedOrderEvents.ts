import { useEffect, useRef } from "react";
import { subscribeOrderStream } from "./new-order-events";
import { useSessionStore } from "../auth/stores/session";

/** Keep open receipts current through events and recovery reads; never initiate a staff write. */
export function useConfirmedOrderEvents(
  shopId: string,
  orderId: string,
  refresh: () => void,
  busy = false,
) {
  const callback = useRef(refresh);
  const waiting = useRef<string | null>(null);
  const scopeKey = JSON.stringify([shopId, orderId]);
  const busyRef = useRef(busy);
  useEffect(() => {
    callback.current = refresh;
    busyRef.current = busy;
    if (waiting.current !== scopeKey) waiting.current = null;
    if (!busy && waiting.current === scopeKey) {
      waiting.current = null;
      callback.current();
    }
  }, [refresh, busy, scopeKey]);
  useEffect(() => {
    let active = true;
    const recover = () => {
      if (!active) return;
      if (busyRef.current) waiting.current = scopeKey;
      else callback.current();
    };
    const stop = subscribeOrderStream(
      `/shops/${encodeURIComponent(shopId)}/orders/confirmed-events`,
      { shopId },
      ["order_confirmed", "order_preparing", "order_ready", "order_completed"],
      () => useSessionStore.getState().accessToken,
      (event, data) => {
        if (event === "resync" || data.orderId === orderId) recover();
      },
      () => {},
      true,
    );
    const interval = setInterval(recover, 15_000);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    return () => {
      active = false;
      stop();
      clearInterval(interval);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
      if (waiting.current === scopeKey) waiting.current = null;
    };
  }, [shopId, orderId, scopeKey]);
}
