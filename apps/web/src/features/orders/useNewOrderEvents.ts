import { useEffect, useRef, useState } from "react";
import {
  subscribeNewOrders,
  type LiveOrderStatus,
  type OrderWorkflow,
} from "./new-order-events";

export function useNewOrderEvents(
  shopId: string,
  workflow: OrderWorkflow,
  refresh: (isNewOrder: boolean) => void,
) {
  const callback = useRef(refresh);
  const [status, setStatus] = useState<LiveOrderStatus | "delayed">(
    "connecting",
  );
  useEffect(() => {
    callback.current = refresh;
  }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delayed = false;
    const unsubscribe = subscribeNewOrders(
      shopId,
      workflow,
      (isNewOrder) => callback.current(isNewOrder),
      (next) => {
        if (next === "live" || next === "denied") {
          clearTimeout(timer);
          timer = undefined;
          delayed = false;
          setStatus(next);
        } else {
          // Brief connection attempts are routine. Repeated retries must not
          // restart the grace period for a continuous outage.
          if (!timer)
            timer = setTimeout(() => {
              delayed = true;
              setStatus("delayed");
            }, 30_000);
          setStatus(delayed ? "delayed" : next);
        }
      },
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [shopId, workflow]);
  return status;
}
