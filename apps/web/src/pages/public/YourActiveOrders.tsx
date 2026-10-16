import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CustomerOrderStatusResponse } from "@paserve/contracts";
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const entries = readActiveOrders(shopSlug);
    void Promise.all(
      entries.map(async (entry) => {
        try {
          const response = await fetch(
            trackingApiUrl(`${trackingPath(shopSlug, entry.id)}/status`),
            {
              credentials: "include",
              cache: "no-store",
              signal: controller.signal,
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
            forgetActiveOrder(shopSlug, entry.id);
            return null;
          }
          return { ...entry, verified: true };
        } catch {
          return { ...entry, verified: false };
        }
      }),
    )
      .then((results) => {
        if (!controller.signal.aborted)
          setOrders(results.filter((entry) => entry !== null));
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      controller.abort();
      clearTimeout(timeout);
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
