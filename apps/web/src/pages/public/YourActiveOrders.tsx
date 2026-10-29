import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CustomerOrderStatusResponse } from "@paserve/contracts";
import { mapConcurrentReads } from "../../lib/api/read-scheduling";
import {
  forgetActiveOrder,
  readActiveOrders,
  trackingApiUrl,
  trackingPath,
} from "../../features/orders/guest-tracking";

export function YourActiveOrders({ shopSlug }: { shopSlug: string }) {
  const [orders, setOrders] = useState(() =>
    readActiveOrders(shopSlug).map((order) => ({ ...order, verified: false })),
  );
  useEffect(() => {
    let active = true,
      loading = false,
      again = false;
    let controller: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (!active) return;
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      const request = new AbortController();
      controller = request;
      timeout = setTimeout(() => request.abort(), 15_000);
      try {
        const entries = readActiveOrders(shopSlug);
        const results = await mapConcurrentReads(
          entries,
          async (entry) => {
            try {
              const response = await fetch(
                trackingApiUrl(`${trackingPath(shopSlug, entry.id)}/status`),
                {
                  credentials: "include",
                  cache: "no-store",
                  signal: request.signal,
                },
              );
              if (!response.ok) return { ...entry, verified: false };
              const data: CustomerOrderStatusResponse = await response.json();
              if (
                data.order?.id !== entry.id ||
                data.order.orderNumber !== entry.orderNumber ||
                !["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED"].includes(
                  data.order.status,
                ) ||
                data.receipt?.shopSlug !== shopSlug
              )
                return { ...entry, verified: false };
              if (
                data.order.status === "REJECTED" ||
                data.order.preparationStatus === "COMPLETED"
              ) {
                if (active && !request.signal.aborted)
                  forgetActiveOrder(shopSlug, entry.id);
                return null;
              }
              return { ...entry, verified: true };
            } catch {
              return { ...entry, verified: false };
            }
          },
          request.signal,
        );
        if (active) setOrders(results.filter((entry) => entry !== null));
      } catch {
        // Navigation/deadline cancellation keeps existing saved-order hints.
      } finally {
        clearTimeout(timeout);
        loading = false;
        if (active && again) {
          again = false;
          void refresh();
        }
      }
    }
    const recover = () => {
      void refresh();
    };
    void refresh();
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    return () => {
      active = false;
      controller?.abort();
      clearTimeout(timeout);
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
    };
  }, [shopSlug]);
  if (!orders.length) return null;
  return (
    <aside className="guest-active-orders" aria-label="Your orders">
      {orders.map((order) => (
        <Link
          key={order.id}
          className="secondary-button"
          to={trackingPath(shopSlug, order.id)}
        >
          {order.verified ? "Your active order" : "Your saved order"} ·{" "}
          {order.orderNumber}
        </Link>
      ))}
      <p>
        Open your order to check its latest status. If tracking access is lost,
        give the counter staff your order number.
      </p>
    </aside>
  );
}
