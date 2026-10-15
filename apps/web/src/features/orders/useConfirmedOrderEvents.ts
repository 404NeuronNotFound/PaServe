import { useEffect, useRef } from "react";
import { subscribeOrderStream } from "./new-order-events";
import { useSessionStore } from "../auth/stores/session";

/** Refetch the open review; confirmation never initiates a staff write. */
export function useConfirmedOrderEvents(
  shopId: string,
  orderId: string,
  refresh: () => void,
  busy = false,
) {
  const callback = useRef(refresh);
  const waiting = useRef(false);
  const busyRef = useRef(busy);
  useEffect(() => {
    callback.current = refresh;
    busyRef.current = busy;
    if (!busy && waiting.current) {
      waiting.current = false;
      callback.current();
    }
  }, [refresh, busy]);
  useEffect(
    () =>
      subscribeOrderStream(
        `/shops/${encodeURIComponent(shopId)}/orders/confirmed-events`,
        { shopId },
        [
          "order_confirmed",
          "order_preparing",
          "order_ready",
          "order_completed",
        ],
        () => useSessionStore.getState().accessToken,
        (event, data) => {
          if (event === "resync" || data.orderId === orderId) {
            if (busyRef.current) waiting.current = true;
            else callback.current();
          }
        },
        () => {},
        true,
      ),
    [shopId, orderId],
  );
}
