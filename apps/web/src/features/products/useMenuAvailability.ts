import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeOrderStream } from "../orders/new-order-events";

/** Public invalidations contain no credentials, product details, or staff data. */
export function useMenuAvailability(shopSlug: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!shopSlug) return;
    let active = true,
      loading = false,
      again = false;
    const queryKey = ["public-menu", shopSlug];
    async function refresh(force = true) {
      if (!active) return;
      if (loading) {
        if (force) again = true;
        return;
      }
      // A slow multi-page load must be able to finish between fallback polls.
      if (!force && client.isFetching({ queryKey })) return;
      loading = true;
      try {
        // Discard a pre-event read so a late snapshot cannot undo availability.
        if (force) await client.cancelQueries({ queryKey });
        if (active) await client.invalidateQueries({ queryKey });
      } catch {
        // Query errors stay with the menu; reconnect/polling will retry.
      } finally {
        loading = false;
        if (again) {
          again = false;
          void refresh();
        }
      }
    }
    const recover = () => {
      void refresh();
    };
    const stop = subscribeOrderStream(
      `/menu/${encodeURIComponent(shopSlug)}/availability-events`,
      { shopSlug },
      ["product_sold_out", "product_available"],
      () => null,
      recover,
      () => {},
      false,
      true,
    );
    const interval = setInterval(() => void refresh(false), 15_000);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    return () => {
      active = false;
      stop();
      clearInterval(interval);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
    };
  }, [client, shopSlug]);
}
