import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import type {
  ApiErrorResponse,
  OrderDecisionResponse,
  VerifyOrderQrResponse,
} from "@paserve/contracts";
import { CUSTOMER_NOTE_PATTERN } from "@paserve/contracts";
import {
  verifyScannedOrder,
  lookupOrderNumber,
} from "../../features/cashier/order-qr";
import { decideOrder } from "../../features/cashier/order-decision";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { CashierOrderReview } from "./CashierOrderReview";

function failureMessage(error: unknown) {
  if (
    isAxiosError<ApiErrorResponse>(error) &&
    error.response &&
    typeof error.response.data?.message === "string"
  )
    return error.response.data.message;
  return "Unable to check the current order. Check your connection and refresh before proceeding.";
}

export function CashierOrderDecision({
  order,
  qrToken,
  onNext,
}: {
  order: VerifyOrderQrResponse["order"];
  qrToken: string;
  onNext: () => void;
}) {
  const [review, setReview] = useState(order);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(
    order.status !== "PENDING_CONFIRMATION" || order.paymentStatus !== "UNPAID",
  );
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<"confirm" | "reject" | null>(null);
  const [reason, setReason] = useState("");
  const [decision, setDecision] = useState<
    OrderDecisionResponse["order"] | null
  >(null);
  const running = useRef(false);
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (decision) resultHeading.current?.focus();
  }, [decision]);

  async function refresh(nextAction: "confirm" | "reject" | null = null) {
    if (running.current) return;
    if (nextAction === "reject" && !CUSTOMER_NOTE_PATTERN.test(reason)) {
      setMessage(
        "The rejection reason contains unsupported characters. Use plain text.",
      );
      return;
    }
    running.current = true;
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    request.current = controller;
    try {
      const saved = qrToken
        ? await verifyScannedOrder(review.shopId, qrToken, controller.signal)
        : await lookupOrderNumber(
            review.shopId,
            review.orderNumber,
            controller.signal,
          );
      if (!active.current || controller.signal.aborted) return;
      setReview(saved);
      const eligible =
        saved.status === "PENDING_CONFIRMATION" &&
        saved.paymentStatus === "UNPAID";
      setBlocked(!eligible);
      if (!eligible)
        setMessage(
          "This order is no longer eligible for a cashier decision. Scan another order or ask the shop owner for help.",
        );
      else if (saved.reviewVersion !== review.reviewVersion) {
        setReason("");
        setMessage(
          "This order changed. Review the updated details before choosing Confirm or Reject again.",
        );
      } else if (nextAction) setAction(nextAction);
      else
        setMessage(
          "Order refreshed. Review these details before confirming or rejecting.",
        );
    } catch (error) {
      if (active.current && !controller.signal.aborted) {
        setBlocked(true);
        setMessage(failureMessage(error));
      }
    } finally {
      running.current = false;
      if (active.current && !controller.signal.aborted) setBusy(false);
    }
  }

  async function submit() {
    if (!action || running.current || blocked) return;
    running.current = true;
    setBusy(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const saved = await decideOrder(
        review,
        qrToken,
        action,
        reason,
        controller.signal,
      );
      if (active.current && !controller.signal.aborted) {
        setDecision(saved);
        setAction(null);
      }
    } catch (error) {
      if (!active.current || controller.signal.aborted) return;
      setBlocked(true);
      setAction(null);
      const status = isAxiosError(error) ? error.response?.status : undefined;
      setMessage(
        status && status >= 400 && status < 500
          ? `${failureMessage(error)} Refresh before choosing another action.`
          : "The decision result could not be confirmed. Do not take payment or process this order again until its saved state is checked. Refresh or ask the shop owner for help.",
      );
    } finally {
      running.current = false;
      if (active.current && !controller.signal.aborted) setBusy(false);
    }
  }

  if (decision)
    return (
      <section
        className="scanner-panel scanner-result"
        aria-labelledby="cashier-decision-title"
      >
        <h2 id="cashier-decision-title" ref={resultHeading} tabIndex={-1}>
          Order {decision.status === "CONFIRMED" ? "confirmed" : "rejected"}
        </h2>
        <p role="status">
          {decision.orderNumber} has been {decision.status.toLowerCase()}.
        </p>
        <p>Payment status: unpaid. This decision did not record payment.</p>
        {decision.rejectionReason && (
          <p className="cashier-item-note">
            Reason: {decision.rejectionReason}
          </p>
        )}
        <button className="secondary-button" onClick={onNext}>
          Scan another order
        </button>
      </section>
    );
  return (
    <CashierOrderReview
      order={review}
      onNext={onNext}
      source={qrToken ? "qr" : "number"}
      busy={busy || Boolean(action)}
    >
      <div className="cashier-decision-controls">
        <p>Confirmation approves this order. Payment is a separate step.</p>
        <button
          className="secondary-button"
          disabled={busy || Boolean(action)}
          onClick={() => {
            void refresh();
          }}
        >
          Refresh order
        </button>
        <div className="field">
          <label htmlFor="cashier-rejection-reason">
            Rejection reason (optional)
          </label>
          <textarea
            id="cashier-rejection-reason"
            value={reason}
            maxLength={300}
            disabled={busy || blocked || Boolean(action)}
            onChange={(event) => setReason(event.target.value)}
            aria-describedby="cashier-rejection-reason-hint"
          />
          <p id="cashier-rejection-reason-hint">
            Saved only when you reject the order. Up to 300 characters.
          </p>
        </div>
        <div className="scanner-controls">
          <button
            className="primary-button"
            disabled={busy || blocked || Boolean(action)}
            onClick={() => {
              void refresh("confirm");
            }}
          >
            Confirm order
          </button>
          <button
            className="secondary-button"
            disabled={busy || blocked || Boolean(action)}
            onClick={() => {
              void refresh("reject");
            }}
          >
            Reject order
          </button>
        </div>
        {busy && (
          <p role="status">Checking or saving the order. Please wait…</p>
        )}
        {message && (
          <InlineMessage tone={blocked ? "error" : "warning"}>
            {message}
          </InlineMessage>
        )}
      </div>
      <DecisionDialog
        open={Boolean(action)}
        title={
          action === "confirm" ? "Confirm this order?" : "Reject this order?"
        }
        description={
          action === "confirm"
            ? `Approve ${review.orderNumber}? Payment remains unpaid and must be handled separately.`
            : `Reject ${review.orderNumber}? This closes the pending order. No payment will be recorded.`
        }
        confirmLabel={action === "confirm" ? "Confirm order" : "Reject order"}
        cancelLabel="Keep reviewing"
        destructive={action === "reject"}
        onConfirm={submit}
        onClose={() => setAction(null)}
      />
    </CashierOrderReview>
  );
}
