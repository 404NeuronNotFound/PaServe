import { useEffect, useRef, useState } from "react";
import type { CustomerOrderStatusResponse } from "@paserve/contracts";
import { PREPARATION_STATUSES } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { parseOrderQrToken } from "./order-qr-reference";
import { subscribeOrderStream } from "./new-order-events";
import {
  readOrderReceipt,
  recoverOrderReceipt,
  type OrderReceipt,
} from "../cart/order-receipt";
import {
  forgetActiveOrder,
  isTrackingOrderId,
  redeemTrackingLink,
  rememberActiveOrder,
} from "./guest-tracking";

function phase(order: CustomerOrderStatusResponse["order"]) {
  return order.status === "CONFIRMED"
    ? 1 +
        (order.preparationStatus
          ? PREPARATION_STATUSES.indexOf(order.preparationStatus) + 1
          : 0)
    : 0;
}

export function useCustomerConfirmation(
  shopSlug: string,
  orderId: string,
  token: string | null = null,
) {
  const [linkVersion, setLinkVersion] = useState(0);
  const latest = useRef<{
    key: string;
    order: CustomerOrderStatusResponse["order"];
  } | null>(null);
  useEffect(() => {
    const reopen = () => {
      if (window.location.hash.startsWith("#tracking="))
        setLinkVersion((value) => value + 1);
    };
    window.addEventListener("hashchange", reopen);
    return () => window.removeEventListener("hashchange", reopen);
  }, []);
  const [health, setHealth] = useState<{
    key: string;
    state: "current" | "stale" | "denied";
  } | null>(null);
  const [saved, setSaved] = useState<{
    key: string;
    order: CustomerOrderStatusResponse["order"];
    receipt: OrderReceipt | null;
  } | null>(null);
  const key = JSON.stringify([shopSlug, orderId, token]);
  useEffect(() => {
    const reference = token ? parseOrderQrToken(token, "order-tracking") : null;
    if (
      !isTrackingOrderId(orderId) ||
      (token && (!reference || reference.orderId !== orderId))
    )
      return;
    const established = redeemTrackingLink(shopSlug, orderId);
    let active = true,
      loading = false,
      again = false,
      denied = false,
      terminal = false;
    let request: AbortController | undefined;
    const previous = latest.current?.key === key ? latest.current.order : null;
    let latestPhase = previous ? phase(previous) : -1;
    let latestUpdatedAt = previous ? Date.parse(previous.updatedAt) : -Infinity;
    let unsubscribe = () => {};
    let subscribed = false;
    const recover = () => {
      void refresh();
    };
    function stopWatching() {
      clearInterval(interval);
      unsubscribe();
      unsubscribe = () => {};
      window.removeEventListener("focus", recover);
      window.removeEventListener("online", recover);
    }
    const path = `/menu/${encodeURIComponent(shopSlug)}/orders/${encodeURIComponent(orderId)}`;
    async function refresh() {
      if (!active || denied || terminal) return;
      if (loading) {
        again = true;
        return;
      }
      loading = true;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 15_000);
      try {
        try {
          await established;
        } catch {
          denied = true;
          stopWatching();
          throw new Error("Tracking link unavailable");
        }
        if (!active) return;
        const response = await fetch(
          `${(api.defaults?.baseURL ?? "").replace(/\/$/, "")}${path}/status`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: "include",
            referrerPolicy: "no-referrer",
            signal: request.signal,
            cache: "no-store",
          },
        );
        if ([401, 403, 404].includes(response.status)) {
          denied = true;
          if (active) setHealth({ key, state: "denied" });
          stopWatching();
          return;
        }
        if (!response.ok) throw new Error("Unable to read order");
        const data: CustomerOrderStatusResponse = await response.json();
        const order = data?.order;
        if (
          !order ||
          order.id !== orderId ||
          !isTrackingOrderId(order.shopId) ||
          (reference && order.shopId !== reference.shopId) ||
          !["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED"].includes(
            order.status,
          ) ||
          !["UNPAID", "PAID"].includes(order.paymentStatus) ||
          (order.status !== "CONFIRMED" && order.paymentStatus !== "UNPAID") ||
          !Number.isFinite(Date.parse(order.updatedAt)) ||
          (order.preparationStatus != null &&
            (!PREPARATION_STATUSES.includes(order.preparationStatus) ||
              order.status !== "CONFIRMED" ||
              order.paymentStatus !== "PAID" ||
              (order.preparationStatus !== "QUEUED" &&
                (!order.preparationStartedAt ||
                  !Number.isFinite(
                    Date.parse(order.preparationStartedAt),
                  ))))) ||
          ((order.preparationStatus === "READY" ||
            order.preparationStatus === "COMPLETED") &&
            (!order.preparationReadyAt ||
              !Number.isFinite(Date.parse(order.preparationReadyAt)) ||
              Date.parse(order.preparationReadyAt) <
                Date.parse(order.preparationStartedAt!))) ||
          (order.preparationStatus === "COMPLETED" &&
            (!order.completedAt ||
              !Number.isFinite(Date.parse(order.completedAt)) ||
              Date.parse(order.completedAt) <
                Date.parse(order.preparationReadyAt!))) ||
          (order.status === "CONFIRMED" &&
            (order.paymentStatus !== "PAID" ||
              !order.confirmedAt ||
              !Number.isFinite(Date.parse(order.confirmedAt))))
        )
          throw new Error("Invalid order status");
        if (active) {
          const nextPhase = phase(order);
          const nextUpdatedAt = Date.parse(order.updatedAt);
          if (
            nextPhase < latestPhase ||
            (nextPhase === latestPhase && nextUpdatedAt < latestUpdatedAt)
          ) {
            setHealth({ key, state: "stale" });
            return;
          }
          const receipt = data.receipt
            ? readOrderReceipt(shopSlug, orderId, data.receipt)
            : null;
          if (
            data.receipt &&
            (!receipt || receipt.orderNumber !== order.orderNumber)
          )
            throw new Error("Invalid saved receipt");
          if (receipt) recoverOrderReceipt(shopSlug, orderId, receipt);
          setHealth({ key, state: "current" });
          latestPhase = nextPhase;
          latestUpdatedAt = nextUpdatedAt;
          latest.current = { key, order };
          if (
            order.status === "REJECTED" ||
            order.preparationStatus === "COMPLETED"
          )
            forgetActiveOrder(shopSlug, orderId);
          else if (data.trackingExpiresAt)
            rememberActiveOrder(
              shopSlug,
              orderId,
              order.orderNumber,
              Date.parse(data.trackingExpiresAt),
            );
          setSaved((previous) =>
            previous?.key === key &&
            (phase(previous.order) > phase(order) ||
              (phase(previous.order) === phase(order) &&
                Date.parse(previous.order.updatedAt) >
                  Date.parse(order.updatedAt)))
              ? previous
              : { key, order, receipt },
          );
          if (!subscribed) {
            subscribed = true;
            unsubscribe = subscribeOrderStream(
              `${path}/events`,
              { shopId: order.shopId, orderId },
              [
                "order_confirmed",
                "order_preparing",
                "order_ready",
                "order_completed",
              ],
              () => token,
              () => {
                void refresh();
              },
              () => {},
              false,
              false,
              !token,
            );
          }
        }
        if (
          active &&
          (order.preparationStatus === "COMPLETED" ||
            order.status === "REJECTED")
        ) {
          terminal = true;
          stopWatching();
        }
      } catch {
        if (active) setHealth({ key, state: denied ? "denied" : "stale" });
      } finally {
        clearTimeout(timeout);
        loading = false;
        if (again) {
          again = false;
          void refresh();
        }
      }
    }
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, 15_000);
    window.addEventListener("focus", recover);
    window.addEventListener("online", recover);
    return () => {
      active = false;
      request?.abort();
      stopWatching();
    };
  }, [shopSlug, orderId, token, key, linkVersion]);
  const reference = token ? parseOrderQrToken(token, "order-tracking") : null;
  return {
    order: saved?.key === key ? saved.order : null,
    receipt: saved?.key === key ? saved.receipt : null,
    state:
      !isTrackingOrderId(orderId) ||
      (token && (!reference || reference.orderId !== orderId))
        ? "unavailable"
        : health?.key === key
          ? health.state
          : "loading",
  };
}
