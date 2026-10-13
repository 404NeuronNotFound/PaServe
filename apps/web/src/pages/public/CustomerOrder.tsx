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
  type CartItem,
} from "../../features/cart/cart";
import { parseCartLine } from "../../features/cart/cart-storage";
import { orderSubmissionRequest } from "../../features/cart/order-submission";
import { isCreatedOrderResponse } from "../../features/cart/order-confirmation";
import { pendingOrders } from "../../features/cart/pending-orders";
import { CartReview, type CartReviewSnapshot } from "./CartReview";
import { api } from "../../lib/api/client";
import { formatCartPrice } from "../../lib/money";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { isPublicTableContext } from "../../features/shops/customer-table";
import { FiArrowRight } from "react-icons/fi";

type Attempt = {
  request: CreateCustomerOrderRequest;
  lines: string[];
  review?: CartReviewSnapshot;
};
function readAttempt(key: string, shopSlug: string): Attempt | null {
  try {
    const saved = JSON.parse(
      pendingOrders.read(key) ?? "null",
    ) as Attempt | null;
    if (!(
      saved &&
      typeof saved.request?.requestId === "string" &&
      Array.isArray(saved.request.items) &&
      Array.isArray(saved.lines)
    ))
      return null;
    // Display snapshots never establish the request's identity or pricing.
    if (saved.review) {
      const items = Array.isArray(saved.review.items)
        ? saved.review.items.map(parseCartLine)
        : [];
      if (
        !items.length ||
        items.some((item) => !item) ||
        items.length > 100 ||
        items.length !== saved.lines.length ||
        items.some((item, index) => item?.lineId !== saved.lines[index]) ||
        JSON.stringify(
          cartCheckoutLines(
            { [shopSlug]: items.filter((item): item is CartItem => !!item) },
            shopSlug,
          ),
        ) !== JSON.stringify(saved.request.items) ||
        saved.review.mode !== (saved.request.mode ?? "DINE_IN") ||
        (saved.review.mode === "DINE_IN" &&
          (!isPublicTableContext(saved.review.table) ||
            saved.review.table.code !== saved.request.tableCode ||
            saved.review.table.shopSlug !== shopSlug))
      ) {
        delete saved.review;
      } else saved.review = { ...saved.review, items: items as CartItem[] };
    }
    return saved;
  } catch {
    return null;
  }
}
export function CustomerOrder({
  shopSlug,
  table,
  onModeChange,
  initialMode,
  onReviewChange,
  editing = false,
  onOrderPlaced,
}: {
  shopSlug: string;
  table?: PublicTableContext;
  onModeChange?: (mode: "DINE_IN" | "TAKEOUT") => void;
  initialMode?: "DINE_IN" | "TAKEOUT";
  onReviewChange?: (review: CartReviewSnapshot | null) => void;
  editing?: boolean;
  onOrderPlaced?: (order: CustomerOrderResponse["order"]) => void;
}) {
  const key = `paserve-pending-order:v1:${shopSlug}`;
  const [attempt, setAttempt] = useState<Attempt | null>(() =>
    readAttempt(key, shopSlug),
  );
  const [choice, setChoice] = useState<"DINE_IN" | "TAKEOUT">(
    initialMode ?? (table ? "DINE_IN" : "TAKEOUT"),
  );
  const [review, setReview] = useState<CartReviewSnapshot | null>(null);
  const items = useCart((state) => cartItemsForShop(state.shops, shopSlug));
  const staleReview =
    !attempt &&
    !!review &&
    (review.fingerprint !== JSON.stringify(items) ||
      (review.mode === "DINE_IN" &&
        (review.table?.code !== table?.code ||
          review.table?.number !== table?.number)));
  const visibleReview = attempt?.review ?? (staleReview ? null : review);
  useEffect(() => {
    onReviewChange?.(visibleReview);
  }, [visibleReview, onReviewChange]);
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
  const count = items.length;
  const action = useRef<HTMLButtonElement>(null);
  function clearSubmittedLines(completed: Attempt) {
    // Remove only the unchanged lines already included in this saved order.
    cartItemsForShop(useCart.getState().shops, shopSlug).forEach((item) => {
      const index = completed.lines.indexOf(item.lineId);
      if (
        index >= 0 &&
        JSON.stringify({
          productId: item.productId,
          ...cartSelectionRequest(item),
        }) === JSON.stringify(completed.request.items[index])
      )
        useCart.getState().remove(shopSlug, item.lineId);
    });
  }
  function reviewOrder() {
    if (editing || busy.current) return;
    setError("");
    try {
      const items = cartItemsForShop(useCart.getState().shops, shopSlug);
      if (!items.length || items.length > 100)
        throw new Error(
          "Review between 1 and 100 configured items before placing your order.",
        );
      if (mode === "DINE_IN") {
        try {
          const selection = cartCheckoutRequest(
            useCart.getState().shops,
            shopSlug,
          );
          if (
            !table?.checkoutToken ||
            selection.tableCode !== table.code ||
            selection.tableToken !== table.checkoutToken
          )
            throw new Error(
              "Scan your table QR again before placing an order.",
            );
        } catch {
          throw new Error("Scan your table QR again before placing an order.");
        }
      }
      const copied = items.map(parseCartLine);
      if (copied.some((item) => !item))
        throw new Error(
          "Your cart could not be reviewed. Remove and add any unavailable items again.",
        );
      setReview({
        items: copied as CartItem[],
        mode,
        ...(mode === "DINE_IN" && table ? { table: { ...table } } : {}),
        fingerprint: JSON.stringify(items),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your cart could not be reviewed.",
      );
    }
  }
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
        if (
          !review ||
          review.mode !== mode ||
          JSON.stringify(cartItemsForShop(state.shops, shopSlug)) !==
            review.fingerprint ||
          (mode === "DINE_IN" &&
            (review.table?.code !== table?.code ||
              review.table?.number !== table?.number))
        ) {
          setReview(null);
          setError(
            "Your cart or table changed. Review the updated order before submitting.",
          );
          return;
        }
        const request: CreateCustomerOrderRequest =
          mode === "TAKEOUT"
            ? {
                requestId: crypto.randomUUID(),
                mode: "TAKEOUT",
                items: cartCheckoutLines(
                  { [shopSlug]: review.items },
                  shopSlug,
                ),
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
                  items: cartCheckoutLines(
                    { [shopSlug]: review.items },
                    shopSlug,
                  ),
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
          lines: review.items.map((item) => item.lineId),
          review,
        };
        setAttempt(sent);
        pendingOrders.write(key, sent);
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
        pendingOrders.write(key, sent);
      }
      const { data } = await api.post<CustomerOrderResponse>(
        `/menu/${encodeURIComponent(shopSlug)}/orders`,
        orderSubmissionRequest(sent.request),
      );
      if (!isCreatedOrderResponse(data, sent.request, shopSlug)) {
        throw new Error("The order response could not be confirmed.");
      }
      setReceipt(data.order);
      clearSubmittedLines(sent);
      setAttempt(null);
      setReview(null);
      pendingOrders.remove(key);
      onOrderPlaced?.(data.order);
    } catch (cause) {
      if (!sent) setReview(null);
      const status = isAxiosError(cause) ? cause.response?.status : undefined;
      const invalidContext =
        isAxiosError(cause) &&
        cause.response?.data?.code === "TABLE_CONTEXT_INVALID";
      if (
        sent &&
        status === 409 &&
        isAxiosError(cause) &&
        cause.response?.data?.code === "ORDER_ALREADY_PROCESSED"
      ) {
        clearSubmittedLines(sent);
        setAttempt(null);
        setReview(null);
        setReceipt(null);
        pendingOrders.remove(key);
        setError(
          "This order has already been processed at the counter. Ask the staff for its current status. Unchanged submitted items were removed from your cart; any new or edited items are kept for your next order.",
        );
      } else if (invalidContext) {
        setError(
          "Scan the original table QR again, then confirm this same order. Your cart is saved.",
        );
      } else if (
        !attempt &&
        status &&
        status >= 400 &&
        status < 500 &&
        status !== 409 &&
        status !== 408 &&
        status !== 429
      ) {
        setAttempt(null);
        setReview(null);
        pendingOrders.remove(key);
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
      {!visibleReview && (
        <fieldset
          className="customer-order-mode"
          disabled={pending || !!attempt}
        >
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
      )}
      {visibleReview && !onReviewChange && (
        <CartReview review={visibleReview} />
      )}
      {!visibleReview && (
        <p className="field-hint">
          {mode === "TAKEOUT"
            ? "Collect your order at the shop. This order will not be linked to a table."
            : `Dine-in · Table ${table?.number ?? "from your original QR"}.`}{" "}
          Final prices are calculated when you place your order.
        </p>
      )}
      {receipt && (
        <p role="status">
          {receipt.mode === "TAKEOUT"
            ? "Pickup order placed."
            : `Order placed for Table ${receipt.table.number}.`}{" "}
          Total {formatCartPrice(receipt.totalPrice)}. Order reference:{" "}
          {receipt.orderNumber ?? "Unavailable"}. Pending. Your order is not yet
          in the kitchen queue. The cashier must confirm your order and payment
          before the kitchen starts preparing it.
          {!receipt.orderNumber &&
            " Ask the counter staff for help with your submitted order."}
        </p>
      )}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
      {staleReview && (
        <InlineMessage tone="warning">
          Your cart or table changed. Review the updated order before
          submitting.
        </InlineMessage>
      )}
      {attempt && !pending && (
        <p className="field-hint">
          {wrongTable
            ? "An order from another table needs confirmation. Scan that table’s QR to continue."
            : mode === "TAKEOUT"
              ? "An earlier pickup order needs confirmation."
              : "An earlier table order needs confirmation."}
        </p>
      )}
      {attempt && !attempt.review && (
        <p className="field-hint">
          The original review is unavailable on this device. Confirm the
          previous order to check its status.
        </p>
      )}
      {editing && !visibleReview && !attempt && (
        <p className="field-hint">
          Save or cancel your item changes before reviewing the order.
        </p>
      )}
      <div className="customer-order-actions">
        {visibleReview && !attempt && (
          <button
            type="button"
            className="secondary-button"
            disabled={pending}
            onClick={() => {
              setReview(null);
              setError("");
              requestAnimationFrame(() => action.current?.focus());
            }}
          >
            Edit cart
          </button>
        )}
        <button
          key={
            attempt
              ? "retry-order"
              : review && !staleReview
                ? "submit-order"
                : "review-order"
          }
          ref={action}
          type="button"
          className="primary-button"
          disabled={
            pending ||
            (!count && !attempt) ||
            wrongTable ||
            (!attempt && editing)
          }
          onClick={() => {
            if (attempt || (review && !staleReview)) void submit();
            else reviewOrder();
          }}
        >
          {pending
            ? "Placing order…"
            : attempt
              ? "Confirm previous order"
              : !review || staleReview
                ? "Review order"
                : mode === "TAKEOUT"
                  ? "Place pickup order"
                  : "Place dine-in order"}
          {!pending && <FiArrowRight aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
