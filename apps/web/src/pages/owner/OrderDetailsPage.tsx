import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  FiArrowLeft,
  FiFileText,
  FiLayers,
  FiCreditCard,
  FiClock,
  FiZap,
  FiPrinter,
} from "react-icons/fi";
import type { CurrentUserResponse, OwnerOrderAction } from "@paserve/contracts";
import { shopPath, useActiveShop } from "../../features/shops/active-shop";
import { currentUserKey } from "../../features/auth/api/session";
import {
  getOrderDetails,
  orderDetailsKey,
} from "../../features/orders/order-details";
import {
  startPreparing,
  markReady,
  completeOrder,
} from "../../features/kitchen/queue";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { ReceiptDocument } from "../../components/shops/ReceiptDocument";
import { ReceiptShopDetails } from "../../components/shops/ReceiptShopDetails";
import { ReceiptPaymentMethod } from "../public/ReceiptPaymentMethod";
import { formatCartPrice } from "../../lib/money";
import { formatReceiptDateTime } from "../../lib/receipt-date-time";
import "./order-details.css";
import { OrderViewsNavigation } from "./OrderViewsNavigation";
import "../cashier/receipt-print.css";

const label = (value: string) =>
  ({
    PLACED: "Order placed",
    PENDING_CONFIRMATION: "Pending confirmation",
    CONFIRMED: "Confirmed",
    REJECTED: "Rejected",
    PAID: "Paid",
    UNPAID: "Unpaid",
    QUEUED: "Queued",
    PREPARING: "Preparing",
    READY: "Ready",
    COMPLETED: "Fulfilled",
  })[value] ?? value;
const actionLabels = {
  START_PREPARING: "Start preparing",
  MARK_READY: "Mark ready",
  COMPLETE: "Mark fulfilled",
};
type PreparationAction = keyof typeof actionLabels;

export function OrderDetailsPage() {
  const { orderId = "" } = useParams();
  const membership = useActiveShop();
  const userId =
    useQueryClient().getQueryData<CurrentUserResponse>(currentUserKey)!.user.id;
  return (
    <OrderDetailsWorkspace
      key={`${userId}:${membership.shopId}:${membership.role}:${orderId}`}
      userId={userId}
      orderId={orderId}
    />
  );
}

function OrderDetailsWorkspace({
  userId,
  orderId,
}: {
  userId: string;
  orderId: string;
}) {
  const { shopId, role } = useActiveShop();
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const [receipt, setReceipt] = useState(false);
  const [confirm, setConfirm] = useState<PreparationAction | null>(null);
  const [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: orderDetailsKey(userId, shopId, orderId),
    queryFn: ({ signal }) => getOrderDetails(shopId, orderId, signal),
    enabled: role === "OWNER" && !!orderId,
    retry: false,
    networkMode: "always",
    gcTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: 15000,
  });
  const mutation = useMutation({
    networkMode: "always",
    mutationFn: async (action: PreparationAction) => {
      await {
        START_PREPARING: startPreparing,
        MARK_READY: markReady,
        COMPLETE: completeOrder,
      }[action](shopId, orderId);
    },
    retry: false,
    onSuccess: async (_data, action) => {
      setNotice(`${actionLabels[action]} saved.`);
      await Promise.all([
        client.invalidateQueries({
          queryKey: orderDetailsKey(userId, shopId, orderId),
        }),
        client.invalidateQueries({
          queryKey: ["owner-orders", userId, shopId],
        }),
        client.invalidateQueries({
          queryKey: ["kitchen", "queue", userId, shopId],
        }),
      ]);
    },
    onError: () => {
      void query.refetch();
    },
  });
  useEffect(() => {
    document.title = "Order details · PaServe";
    heading.current?.focus();
  }, []);
  if (role !== "OWNER")
    return (
      <InlineMessage>
        Only this shop’s owner can view order details.
      </InlineMessage>
    );
  const order = query.isSuccess ? query.data.order : null;
  const permitted = (action: OwnerOrderAction) =>
    !!order?.permittedActions.includes(action);
  const denied =
    isAxiosError(query.error) &&
    [401, 403, 404].includes(query.error.response?.status ?? 0);
  return (
    <section className="shop-context-content owner-order-details">
      <Link className="owner-order-back" to={`${shopPath(shopId)}/orders`}>
        <FiArrowLeft aria-hidden="true" /> Back to active orders
      </Link>
      <header className="active-orders-header">
        <div className="owner-orders-heading">
          <span className="owner-orders-emblem">
            <FiFileText aria-hidden="true" />
          </span>
          <div>
            <p className="section-label">OWNER / ORDER DETAILS</p>
            <h1 ref={heading} tabIndex={-1}>
              {order?.orderNumber ?? "Order details"}
            </h1>
            <p>The original order. Every detail, preserved.</p>
          </div>
        </div>
        <button
          className="secondary-button"
          disabled={query.isFetching || mutation.isPending}
          onClick={() => void query.refetch()}
        >
          Refresh
        </button>
      </header>
      <OrderViewsNavigation />
      {query.isPending && <p role="status">Loading saved order details…</p>}
      {query.isError && (
        <div className="active-orders-message">
          <InlineMessage>
            {denied
              ? "This order is unavailable or your access has changed."
              : "We couldn’t load the saved order details. Retry to check the latest status."}
          </InlineMessage>
          <button
            className="secondary-button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {order && (
        <>
          <div className="owner-order-detail-grid">
            <section
              className="owner-order-panel"
              aria-label="Saved order snapshot"
            >
              <h2>
                <FiLayers aria-hidden="true" />
                Saved order snapshot
              </h2>
              <ReceiptShopDetails details={order.shopDetails} />
              <p>
                {order.mode === "TAKEOUT"
                  ? "Takeout"
                  : `Dine-in · Table ${order.tableNumber}`}
              </p>
              {order.snapshotIssue && (
                <InlineMessage tone="warning">
                  {order.snapshotIssue}
                </InlineMessage>
              )}
              {order.items && (
                <ol className="owner-order-items">
                  {order.items.map((item, index) => (
                    <li key={index}>
                      <h3>
                        {item.quantity} × {item.productName}
                      </h3>
                      <p>
                        Base price {formatCartPrice(item.basePrice)} · Unit
                        price {formatCartPrice(item.unitPrice)}
                      </p>
                      {!!item.variants.length && (
                        <div>
                          <h4>Variants</h4>
                          <ul>
                            {item.variants.map((option) => (
                              <li key={option.id}>
                                {option.name} · +
                                {formatCartPrice(option.priceAdjustment)} each
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {!!item.addOns.length && (
                        <div>
                          <h4>Add-ons</h4>
                          <ul>
                            {item.addOns.map((option) => (
                              <li key={option.id}>
                                {option.name} · +
                                {formatCartPrice(option.priceAdjustment)} each
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {item.notes && (
                        <p className="owner-order-note">
                          Customer note: {item.notes}
                        </p>
                      )}
                      <strong>
                        Line total {formatCartPrice(item.totalPrice)}
                      </strong>
                    </li>
                  ))}
                </ol>
              )}
              <p className="owner-order-saved-total">
                Saved total (PHP){" "}
                <strong>{formatCartPrice(order.totalPrice)}</strong>
              </p>
            </section>
            <section
              className="owner-order-panel"
              aria-label="Status and payment"
            >
              <h2>
                <FiCreditCard aria-hidden="true" />
                Status and payment
              </h2>
              <dl>
                <div>
                  <dt>Approval</dt>
                  <dd data-state={order.status}>{label(order.status)}</dd>
                </div>
                <div>
                  <dt>Payment</dt>
                  <dd data-state={order.paymentStatus}>
                    {label(order.paymentStatus)}
                  </dd>
                </div>
                <div>
                  <dt>Preparation</dt>
                  <dd data-state={order.preparationStatus ?? "NOT_STARTED"}>
                    {order.preparationStatus
                      ? label(order.preparationStatus)
                      : "Not started"}
                  </dd>
                </div>
                <div>
                  <dt>Placed</dt>
                  <dd>
                    <time dateTime={order.createdAt}>
                      {formatReceiptDateTime(order.createdAt)}
                    </time>
                  </dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>
                    <time dateTime={order.updatedAt}>
                      {formatReceiptDateTime(order.updatedAt)}
                    </time>
                  </dd>
                </div>
              </dl>
              <ReceiptPaymentMethod
                payment={order.payment}
                confirmed={order.paymentStatus === "PAID"}
              />
              {order.status === "REJECTED" && (
                <p>
                  Rejection reason: {order.rejectionReason ?? "Not captured"}
                </p>
              )}
            </section>
          </div>
          <section
            className="owner-order-panel"
            aria-labelledby="order-history-title"
          >
            <h2 id="order-history-title">
              <FiClock aria-hidden="true" />
              Status history
            </h2>
            <p>
              Recorded milestones only. Missing timestamps and actor identities
              were not captured; this is not a complete event log. Times use
              Asia/Manila.
            </p>
            <ol className="owner-order-history">
              {order.history.map((event) => (
                <li key={event.status} data-state={event.status}>
                  <strong>{label(event.status)}</strong>
                  <time dateTime={event.at}>
                    {formatReceiptDateTime(event.at)}
                  </time>
                  <span>
                    {event.status === "PLACED"
                      ? "Customer submission"
                      : event.actorId
                        ? `Actor ID: ${event.actorId}`
                        : "Actor not captured"}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className="owner-order-panel" aria-label="Permitted actions">
            <h2>
              <FiZap aria-hidden="true" />
              Actions
            </h2>
            {notice && <InlineMessage tone="success">{notice}</InlineMessage>}
            <div className="owner-order-actions">
              {permitted("CASHIER") && (
                <Link
                  className="primary-button"
                  to={`${shopPath(shopId)}/cashier?orderNumber=${encodeURIComponent(order.orderNumber)}`}
                >
                  Review in cashier
                </Link>
              )}
              {(Object.keys(actionLabels) as PreparationAction[])
                .filter(permitted)
                .map((action) => (
                  <button
                    key={action}
                    className="primary-button"
                    disabled={mutation.isPending || query.isFetching}
                    onClick={() => setConfirm(action)}
                  >
                    {actionLabels[action]}
                  </button>
                ))}
              {permitted("RECEIPT") && (
                <button
                  className="secondary-button"
                  onClick={() => setReceipt((value) => !value)}
                >
                  {receipt ? "Hide receipt" : "View receipt"}
                </button>
              )}
            </div>
            {!order.permittedActions.length && (
              <p>No order actions are available in the current state.</p>
            )}
            {permitted("CASHIER") && (
              <p>
                Review the saved items in the cashier workflow before confirming
                payment or rejecting the order.
              </p>
            )}
          </section>
          {receipt && permitted("RECEIPT") && (
            <section
              className="cashier-receipt-page"
              aria-label="Saved paid receipt"
            >
              <div className="receipt-print-controls">
                <button
                  className="secondary-button"
                  onClick={() => window.print()}
                >
                  <FiPrinter aria-hidden="true" /> Print receipt
                </button>
              </div>
              <ReceiptDocument
                shopDetails={order.shopDetails}
                orderContext={
                  order.mode === "TAKEOUT"
                    ? "Takeout"
                    : `Dine-in · Table ${order.tableNumber}`
                }
                orderNumber={order.orderNumber}
                items={order.items ?? undefined}
                totalPrice={order.totalPrice}
                subtotalPrice={order.totalPrice}
                payment={order.payment}
                createdAt={order.createdAt}
                paidAt={order.paidAt}
                completedAt={order.completedAt}
              />
            </section>
          )}
        </>
      )}
      <DecisionDialog
        open={confirm !== null}
        title={confirm ? `${actionLabels[confirm]}?` : "Update order?"}
        description={
          confirm === "COMPLETE"
            ? "Confirm the customer has received this order. This marks the order fulfilled."
            : "Confirm this order is ready for the next preparation stage."
        }
        confirmLabel={confirm ? actionLabels[confirm] : "Confirm"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (!confirm || !permitted(confirm)) throw new Error("Order changed");
          await mutation.mutateAsync(confirm);
        }}
        errorMessage={() =>
          "The order could not be updated. Its status or your access may have changed. Close this dialog and refresh before trying again."
        }
      />
    </section>
  );
}
