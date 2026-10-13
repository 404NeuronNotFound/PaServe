import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { FiCheckCircle, FiDollarSign } from "react-icons/fi";
import type {
  ApiErrorResponse,
  CashPaymentReviewResponse,
} from "@paserve/contracts";
import {
  reviewCashPayment,
  collectCashPayment,
  normalizeCashAmount,
  cashChange,
} from "../../features/cashier/cash-payment";
import { CashierOrderReview } from "./CashierOrderReview";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { formatCartPrice } from "../../lib/money";

function failureMessage(error: unknown) {
  if (
    isAxiosError<ApiErrorResponse>(error) &&
    typeof error.response?.data?.message === "string"
  )
    return error.response.data.message;
  return error instanceof Error
    ? error.message
    : "Unable to check payment. Refresh before collecting cash.";
}
export function CashierCashPayment({
  shopId,
  orderId,
  onNext,
}: {
  shopId: string;
  orderId: string;
  onNext: () => void;
}) {
  const [review, setReview] = useState<CashPaymentReviewResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(true);
  const [blocked, setBlocked] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [recordedHere, setRecordedHere] = useState(false);
  const active = useRef(false),
    running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const normalized = normalizeCashAmount(amount);
  const change =
    review && normalized
      ? cashChange(normalized, review.order.totalPrice)
      : null;
  const invalidAmount = amount.length > 0 && change === null;
  useEffect(() => {
    active.current = true;
    const request = new AbortController();
    controller.current = request;
    void reviewCashPayment(shopId, orderId, request.signal)
      .then((saved) => {
        if (active.current && !request.signal.aborted) {
          setReview(saved);
          setBlocked(false);
        }
      })
      .catch((error) => {
        if (active.current && !request.signal.aborted)
          setError(failureMessage(error));
      })
      .finally(() => {
        if (active.current && !request.signal.aborted) setBusy(false);
      });
    return () => {
      active.current = false;
      controller.current?.abort();
    };
  }, [shopId, orderId]);
  useEffect(() => {
    if (review?.payment) resultHeading.current?.focus();
  }, [review?.payment]);
  async function refresh(open = false) {
    if (running.current || busy) return;
    running.current = true;
    setBusy(true);
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      const saved = await reviewCashPayment(shopId, orderId, request.signal);
      if (!active.current || request.signal.aborted) return;
      setReview(saved);
      setBlocked(false);
      if (review && saved.order.reviewVersion !== review.order.reviewVersion) {
        setAmount("");
        attempt.current = null;
        if (!saved.payment)
          setError(
            "The order changed. Review the saved total and enter the amount received again.",
          );
      } else if (open && !saved.payment && normalized && change !== null)
        setConfirm(true);
    } catch (error) {
      if (active.current && !request.signal.aborted) {
        setBlocked(true);
        setError(failureMessage(error));
      }
    } finally {
      running.current = false;
      if (active.current && !request.signal.aborted) setBusy(false);
    }
  }
  async function collect() {
    if (running.current || blocked || !review || !normalized || change === null)
      return;
    running.current = true;
    setBusy(true);
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      attempt.current ??= crypto.randomUUID();
      const saved = await collectCashPayment(
        shopId,
        orderId,
        {
          requestId: attempt.current,
          reviewVersion: review.order.reviewVersion,
          amountReceived: normalized,
        },
        request.signal,
      );
      if (active.current && !request.signal.aborted) {
        setReview(saved);
        setConfirm(false);
        setRecordedHere(true);
      }
    } catch (error) {
      if (active.current && !request.signal.aborted) {
        setBlocked(true);
        setConfirm(false);
        setError(
          `${failureMessage(error)} The payment result is unconfirmed. Refresh its saved state before collecting or recording cash again.`,
        );
      }
    } finally {
      running.current = false;
      if (active.current && !request.signal.aborted) setBusy(false);
    }
  }
  if (review?.payment)
    return (
      <section
        className="scanner-panel cashier-cash-result"
        aria-labelledby="cash-paid-title"
      >
        <span className="cashier-cash-emblem">
          <FiCheckCircle aria-hidden="true" />
        </span>
        <p className="section-label">PAYMENT COMPLETE / CASH</p>
        <h2 id="cash-paid-title" ref={resultHeading} tabIndex={-1}>
          Cash payment recorded
        </h2>
        <p role="status">{review.order.orderNumber} is paid.</p>
        <dl>
          <div>
            <dt>Order total</dt>
            <dd>{formatCartPrice(review.order.totalPrice)}</dd>
          </div>
          <div>
            <dt>Amount received</dt>
            <dd>{formatCartPrice(review.payment.amountReceived)}</dd>
          </div>
          <div className="cashier-cash-change">
            <dt>Change due</dt>
            <dd>{formatCartPrice(review.payment.changeDue)}</dd>
          </div>
        </dl>
        <p>
          {recordedHere
            ? "Return the change to the customer."
            : "This order already has a saved cash payment. Check with the cashier before handling any cash or change."}
        </p>
        <button className="primary-button" onClick={onNext}>
          Scan another order
        </button>
      </section>
    );
  const controls = (
    <div className="cashier-cash-controls">
      {review && (
        <>
          <label htmlFor="cash-amount">Amount received (PHP)</label>
          <div className="cashier-cash-input">
            <FiDollarSign aria-hidden="true" />
            <input
              id="cash-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              maxLength={13}
              value={amount}
              disabled={busy || blocked || confirm}
              onChange={(event) => {
                setAmount(event.target.value);
                attempt.current = null;
              }}
              aria-invalid={invalidAmount}
              aria-describedby={
                invalidAmount
                  ? "cash-amount-hint cash-amount-error"
                  : "cash-amount-hint"
              }
            />
          </div>
          <p id="cash-amount-hint">
            Enter the cash actually received. It must cover the total.
          </p>
          {invalidAmount && (
            <InlineMessage id="cash-amount-error">
              {normalized
                ? "The amount received is below the order total."
                : "Enter a valid amount with up to two decimal places."}
            </InlineMessage>
          )}
          <div className="cashier-cash-change" role="status">
            <span>Change due</span>
            <strong>{change === null ? "—" : formatCartPrice(change)}</strong>
          </div>
          <button
            className="primary-button"
            disabled={busy || blocked || confirm || change === null}
            onClick={() => void refresh(true)}
          >
            Record cash payment
          </button>
        </>
      )}
      <button
        className="secondary-button"
        disabled={busy || confirm}
        onClick={() => void refresh()}
      >
        Refresh payment
      </button>
      {busy && <p role="status">Checking or recording cash payment…</p>}
      {error && <InlineMessage>{error}</InlineMessage>}
      <DecisionDialog
        open={confirm}
        title="Record cash payment?"
        description={
          review && normalized && change !== null
            ? `Record ${formatCartPrice(normalized)} received for ${review.order.orderNumber}, with ${formatCartPrice(change)} change due? Only continue once the cash is in hand.`
            : "Check the cash before recording payment."
        }
        confirmLabel="Record cash payment"
        cancelLabel="Keep reviewing"
        onConfirm={collect}
        onClose={() => setConfirm(false)}
      />
    </div>
  );
  return review ? (
    <CashierOrderReview
      order={review.order}
      onNext={onNext}
      busy={busy || confirm}
      purpose="payment"
    >
      {controls}
    </CashierOrderReview>
  ) : (
    <section className="scanner-panel" aria-label="Cash payment">
      <h2>Collect cash</h2>
      {controls}
      <button className="secondary-button" onClick={onNext} disabled={busy}>
        Scan another order
      </button>
    </section>
  );
}
