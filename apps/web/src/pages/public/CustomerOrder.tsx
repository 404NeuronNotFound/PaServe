import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import type {
  CreateCustomerOrderRequest,
  CustomerOrderResponse,
  PublicTableContext,
} from "@paserve/contracts";
import {
  cartCheckoutRequest,
  cartCheckoutLines,
  cartItemsForShop,
  cartSelectionRequest,
  useCart,
} from "../../features/cart/cart";
import { api } from "../../lib/api/client";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { isPublicTableContext } from "../../features/shops/customer-table";

type Attempt = { request: CreateCustomerOrderRequest; lines: string[] };
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
export function CustomerOrder({
  shopSlug,
  table,
  onModeChange,
  initialMode,
}: {
  shopSlug: string;
  table?: PublicTableContext;
  onModeChange?: (mode: "DINE_IN" | "TAKEOUT") => void;
  initialMode?: "DINE_IN" | "TAKEOUT";
}) {
  const key = `paserve-pending-order:v1:${shopSlug}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() =>
    readAttempt(key),
  );
  const [choice, setChoice] = useState<"DINE_IN" | "TAKEOUT">(
    initialMode ?? (table ? "DINE_IN" : "TAKEOUT"),
  );
  const mode = attempt ? (attempt.request.mode ?? "DINE_IN") : choice;
  const wrongTable =
    !!attempt &&
    mode === "DINE_IN" &&
    attempt.request.tableCode !== table?.code;
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<CustomerOrderResponse["order"] | null>(
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
      if (sent && wrongTable) {
        setError(
          "Scan the original table QR to confirm your earlier order. It will keep its original table.",
        );
        return;
      }
      if (!sent) {
        const state = useCart.getState();
        const request: CreateCustomerOrderRequest =
          mode === "TAKEOUT"
            ? {
                requestId: crypto.randomUUID(),
                mode: "TAKEOUT",
                items: cartCheckoutLines(state.shops, shopSlug),
              }
            : (() => {
                const selection = cartCheckoutRequest(state.shops, shopSlug);
                if (
                  !table?.checkoutToken ||
                  selection.tableCode !== table.code ||
                  selection.tableToken !== table.checkoutToken
                )
                  throw new Error(
                    "Scan your table QR again before placing an order.",
                  );
                return {
                  ...selection,
                  mode: "DINE_IN",
                  requestId: crypto.randomUUID(),
                  tableCode: table.code,
                  tableToken: table.checkoutToken,
                };
              })();
        if (!request.items.length) {
          throw new Error("Add items to your cart before placing an order.");
        }
        sent = {
          request,
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
      // Refresh only the signature for the original table; never redirect a retry.
      if (
        sent.request.mode !== "TAKEOUT" &&
        sent.request.tableCode === table?.code &&
        table?.checkoutToken
      ) {
        sent = {
          ...sent,
          request: { ...sent.request, tableToken: table.checkoutToken },
        };
        setAttempt(sent);
        try {
          sessionStorage.setItem(key, JSON.stringify(sent));
        } catch {
          /* Keep memory retry. */
        }
      }
      const { data } = await api.post<CustomerOrderResponse>(
        `/menu/${encodeURIComponent(shopSlug)}/orders`,
        sent.request,
      );
      if (
        typeof data.order?.id !== "string" ||
        !data.order.id ||
        data.order.mode !== (sent.request.mode ?? "DINE_IN") ||
        data.order.status !== "PLACED" ||
        data.order.currency !== "PHP" ||
        typeof data.order.totalPrice !== "string" ||
        !/^\d{1,10}\.\d{2}$/.test(data.order.totalPrice) ||
        (data.order.mode === "TAKEOUT"
          ? data.order.table !== null
          : !isPublicTableContext(data.order.table) ||
            data.order.table.shopSlug !== shopSlug ||
            data.order.table.code !== sent.request.tableCode)
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
      const invalidContext =
        isAxiosError(cause) &&
        cause.response?.data?.code === "TABLE_CONTEXT_INVALID";
      if (invalidContext) {
        setError(
          "Scan the original table QR again, then confirm this same order. Your cart is saved.",
        );
      } else if (
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
          mode === "TAKEOUT"
            ? "This pickup order could not be placed. Check item availability, then try again."
            : "This order could not be placed. Check the table and item availability, then try again.",
        );
      } else {
        setError(
          sent
            ? "Your order has not been confirmed. Retry to confirm the same order before placing another. Changes to your cart will stay for your next order."
            : mode === "TAKEOUT"
              ? "Add items to your cart before placing a pickup order."
              : "Scan your table QR again before placing an order.",
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <div className="customer-order">
      <fieldset className="customer-order-mode" disabled={pending || !!attempt}>
        <legend>Order type</legend>
        {table && (
          <label>
            <input
              type="radio"
              name={`order-mode-${shopSlug}`}
              value="DINE_IN"
              checked={mode === "DINE_IN"}
              onChange={() => {
                setError("");
                setChoice("DINE_IN");
              }}
            />
            Dine-in · Table {table.number}
          </label>
        )}
        <label>
          <input
            type="radio"
            name={`order-mode-${shopSlug}`}
            value="TAKEOUT"
            checked={mode === "TAKEOUT"}
            onChange={() => {
              setError("");
              setChoice("TAKEOUT");
            }}
          />
          Takeout / pickup
        </label>
      </fieldset>
      <p className="field-hint">
        {mode === "TAKEOUT"
          ? "Collect your order at the shop. This order will not be linked to a table."
          : `Dine-in · Table ${table?.number ?? "from your original QR"}.`}{" "}
        Final prices are calculated when you place your order.
      </p>
      {receipt && (
        <p role="status">
          {receipt.mode === "TAKEOUT"
            ? "Pickup order placed."
            : `Order placed for Table ${receipt.table.number}.`}{" "}
          Total {formatCartPrice(receipt.totalPrice)}. Order reference:{" "}
          {receipt.id}
        </p>
      )}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {attempt && !pending && (
        <p className="field-hint">
          {wrongTable
            ? "An order from another table needs confirmation. Scan that table’s QR to continue."
            : mode === "TAKEOUT"
              ? "An earlier pickup order needs confirmation."
              : "An earlier table order needs confirmation."}
        </p>
      )}
      <button
        type="button"
        className="primary-button"
        disabled={pending || (!count && !attempt) || wrongTable}
        onClick={() => void submit()}
      >
        {pending
          ? "Placing order…"
          : attempt
            ? "Confirm previous order"
            : mode === "TAKEOUT"
              ? "Place pickup order"
              : "Place dine-in order"}
      </button>
    </div>
  );
}
