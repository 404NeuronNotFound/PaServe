import { useEffect, useState } from "react";
import type { CustomerOrderStatusResponse } from "@paserve/contracts";
import { PREPARATION_STATUSES } from "@paserve/contracts";
import { api } from "../../lib/api/client";
import { parseOrderQrToken } from "./order-qr-reference";
import { subscribeOrderStream } from "./new-order-events";

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
  token: string | null,
) {
  const [health, setHealth] = useState<{
    key: string;
    state: "current" | "stale" | "denied";
  } | null>(null);
  const [saved, setSaved] = useState<{
    key: string;
    order: CustomerOrderStatusResponse["order"];
  } | null>(null);
  const key = JSON.stringify([shopSlug, orderId, token]);
  useEffect(() => {
    const reference = token ? parseOrderQrToken(token) : null;
    if (!token || !reference || reference.orderId !== orderId) return;
    let active = true,
      loading = false,
      again = false,
      denied = false,
      terminal = false;
    let request: AbortController | undefined;
    let latestPhase = -1;
    let latestUpdatedAt = -Infinity;
    let unsubscribe = () => {};
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
        const response = await fetch(
          `${(api.defaults?.baseURL ?? "").replace(/\/$/, "")}${path}/status`,
          {
            headers: { Authorization: `Bearer ${token}` },
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
          order.shopId !== reference!.shopId ||
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
          setHealth({ key, state: "current" });
          latestPhase = nextPhase;
          latestUpdatedAt = nextUpdatedAt;
          setSaved((previous) =>
            previous?.key === key &&
            (phase(previous.order) > phase(order) ||
              (phase(previous.order) === phase(order) &&
                Date.parse(previous.order.updatedAt) >
                  Date.parse(order.updatedAt)))
              ? previous
              : { key, order },
          );
        }
        if (
          active &&
          (order.preparationStatus === "COMPLETED" || order.status === "REJECTED")
        ) {
          terminal = true;
          stopWatching();
        }
      } catch {
        if (active) setHealth({ key, state: "stale" });
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
    unsubscribe = subscribeOrderStream(
      `${path}/events`,
      { shopId: reference.shopId, orderId },
      ["order_confirmed", "order_preparing", "order_ready", "order_completed"],
      () => token,
      () => {
        void refresh();
      },
      () => {},
    );
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
  }, [shopSlug, orderId, token, key]);
  const reference = token ? parseOrderQrToken(token) : null;
  return {
    order: saved?.key === key ? saved.order : null,
    state:
      !reference || reference.orderId !== orderId
        ? "unavailable"
        : health?.key === key
          ? health.state
          : "loading",
  };
}
