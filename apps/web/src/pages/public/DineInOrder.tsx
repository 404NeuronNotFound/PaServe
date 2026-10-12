import { useRef, useState } from "react";
import { isAxiosError } from "axios";
import type {
  CreateDineInOrderRequest,
  DineInOrderResponse,
  PublicTableContext,
} from "@paserve/contracts";
import {
  cartCheckoutRequest,
  cartItemsForShop,
  cartSelectionRequest,
  useCart,
} from "../../features/cart/cart";
import { api } from "../../lib/api/client";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { isPublicTableContext } from "../../features/shops/customer-table";

type Attempt = { request: CreateDineInOrderRequest; lines: string[] };
function readAttempt(key: string): Attempt | null {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(key) ?? "null",
    ) as Attempt | null;
    return saved &&
      typeof saved.request?.requestId === "string" &&
      Array.isArray(saved.request.items) &&
      Array.isArray(saved.lines)
      ? saved
      : null;
  } catch {
    return null;
  }
}
export function DineInOrder({
  shopSlug,
  table,
}: {
  shopSlug: string;
  table: PublicTableContext;
}) {
  const key = `paserve-pending-order:v1:${shopSlug}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() =>
    readAttempt(key),
  );
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<DineInOrderResponse["order"] | null>(
    null,
  );
  const count = useCart(
    (state) => cartItemsForShop(state.shops, shopSlug).length,
  );
  async function submit() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    let sent = attempt;
    try {
      if (!sent) {
        const state = useCart.getState();
        const request = cartCheckoutRequest(state.shops, shopSlug);
        if (
          request.mode !== "DINE_IN" ||
          request.tableCode !== table.code ||
          !request.items.length
        ) {
          throw new Error("Scan your table QR again before placing an order.");
        }
        sent = {
          request: {
            ...request,
            tableCode: table.code,
            requestId: crypto.randomUUID(),
          },
          lines: cartItemsForShop(state.shops, shopSlug).map(
            (item) => item.lineId,
          ),
        };
        setAttempt(sent);
        try {
          sessionStorage.setItem(key, JSON.stringify(sent));
        } catch {
          /* Memory retry remains available. */
        }
      }
      const { data } = await api.post<DineInOrderResponse>(
        `/menu/${encodeURIComponent(shopSlug)}/orders`,
        sent.request,
      );
      if (
        typeof data.order?.id !== "string" ||
        !data.order.id ||
        data.order.mode !== "DINE_IN" ||
        data.order.status !== "PLACED" ||
        data.order.currency !== "PHP" ||
        typeof data.order.totalPrice !== "string" ||
        !/^\d{1,10}\.\d{2}$/.test(data.order.totalPrice) ||
        !isPublicTableContext(data.order.table) ||
        data.order.table.shopSlug !== shopSlug ||
        data.order.table.code !== sent.request.tableCode
      ) {
        throw new Error("The order response could not be confirmed.");
      }
      setReceipt(data.order);
      const completed = sent;
      // Retain any lines edited or added while the request was in flight.
      cartItemsForShop(useCart.getState().shops, shopSlug).forEach((item) => {
        const index = completed.lines.indexOf(item.lineId);
        if (
          index >= 0 &&
          JSON.stringify({
            productId: item.productId,
            ...cartSelectionRequest(item),
          }) === JSON.stringify(completed.request.items[index])
        ) {
          useCart.getState().remove(shopSlug, item.lineId);
        }
      });
      setAttempt(null);
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Storage may be unavailable. */
      }
    } catch (cause) {
      const status = isAxiosError(cause) ? cause.response?.status : undefined;
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 409 &&
        status !== 408 &&
        status !== 429
      ) {
        setAttempt(null);
        try {
          sessionStorage.removeItem(key);
        } catch {
          /* Storage may be unavailable. */
        }
        setError(
          "This order could not be placed. Check the table and item availability, then try again.",
        );
      } else {
        setError(
          sent
            ? "Your order has not been confirmed. Retry to confirm the same order before placing another. Changes to your cart will stay for your next order."
            : "Scan your table QR again before placing an order.",
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div>
      <p className="field-hint">
        Dine-in · Table {table.number}. Final prices are calculated when you
        place your order.
      </p>
      {receipt && (
        <p role="status">
          Order placed for Table {receipt.table.number}. Total{" "}
          {formatCartPrice(receipt.totalPrice)}. Order reference: {receipt.id}
        </p>
      )}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {attempt && !pending && (
        <p className="field-hint">An earlier table order needs confirmation.</p>
      )}
      <button
        type="button"
        className="primary-button"
        disabled={pending || (!count && !attempt)}
        onClick={() => void submit()}
      >
        {pending
          ? "Placing order…"
          : attempt
            ? "Confirm previous order"
            : "Place dine-in order"}
      </button>
    </div>
  );
}
