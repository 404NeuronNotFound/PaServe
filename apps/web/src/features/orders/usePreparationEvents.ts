import { useEffect, useRef } from "react";
import { subscribeOrderStream } from "./new-order-events";
import { useSessionStore } from "../auth/stores/session";

export function usePreparationEvents(shopId: string, refresh: () => void) {
  const callback = useRef(refresh);
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  useEffect(
    () =>
      subscribeOrderStream(
        `/shops/${encodeURIComponent(shopId)}/orders/preparation-events`,
        { shopId },
        ["order_preparing", "order_ready"],
        () => useSessionStore.getState().accessToken,
        () => callback.current(),
        () => {},
        true,
      ),
    [shopId],
  );
}
