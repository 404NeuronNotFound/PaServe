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
    async function refresh() {
      if (!active) return;
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      try {
        // Discard a pre-event read so a late snapshot cannot undo availability.
        await client.cancelQueries({ queryKey });
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
    const interval = setInterval(recover, 15_000);
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
