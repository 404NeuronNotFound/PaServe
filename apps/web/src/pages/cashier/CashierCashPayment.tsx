import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { FiCheckCircle } from "react-icons/fi";
import type {
  ApiErrorResponse,
  CashPaymentReviewResponse,
} from "@paserve/contracts";
import { PAYMENT_REFERENCE_PATTERN } from "@paserve/contracts";
import {
  reviewCashPayment,
  collectCashPayment,
  recordManualGcashPayment,
  recordManualCardPayment,
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
    : "Unable to check payment. Refresh before recording payment.";
}
export function CashierCashPayment({
  shopId,
  orderId,
  onNext,
  initialMethod = "CASH",
}: {
  shopId: string;
  orderId: string;
  onNext: () => void;
  initialMethod?: "CASH" | "GCASH_MANUAL" | "CARD_MANUAL";
}) {
  const [review, setReview] = useState<CashPaymentReviewResponse | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(initialMethod);
  const [receivedConfirmed, setReceivedConfirmed] = useState(false);
  const [reference, setReference] = useState("");
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
  const gcash = method === "GCASH_MANUAL";
  const card = method === "CARD_MANUAL";
  const manual = method !== "CASH";
  const recordLabel = card
    ? "Record card payment"
    : gcash
      ? "Record GCash payment"
      : "Record cash payment";
  const invalidReference = !PAYMENT_REFERENCE_PATTERN.test(reference);
  const eligible = manual
    ? receivedConfirmed && !invalidReference
    : normalized !== null && change !== null;
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
        setReceivedConfirmed(false);
        attempt.current = null;
        if (!saved.payment)
          setError(
            card
              ? "The order changed. Review the saved total and verify external card completion again."
              : gcash
                ? "The order changed. Review the saved total and verify GCash receipt again."
                : "The order changed. Review the saved total and enter the amount received again.",
          );
      } else if (open && !saved.payment && eligible) setConfirm(true);
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
    if (running.current || blocked || !review || !eligible) return;
    running.current = true;
    setBusy(true);
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      attempt.current ??= crypto.randomUUID();
      const recordManual = card
        ? recordManualCardPayment
        : recordManualGcashPayment;
      const saved = manual
        ? await recordManual(
            shopId,
            orderId,
            {
              requestId: attempt.current,
              reviewVersion: review.order.reviewVersion,
              receivedConfirmed: true,
              ...(reference.trim() ? { reference: reference.trim() } : {}),
            },
            request.signal,
          )
        : await collectCashPayment(
            shopId,
            orderId,
            {
              requestId: attempt.current,
              reviewVersion: review.order.reviewVersion,
              amountReceived: normalized!,
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
          `${failureMessage(error)} The payment result is unconfirmed. Refresh its saved state before collecting or recording payment again.`,
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
        <p className="section-label">
          PAYMENT COMPLETE /{" "}
          {review.payment.method === "CASH"
            ? "CASH"
            : review.payment.method === "CARD_MANUAL"
              ? "CARD MANUAL"
              : "GCASH MANUAL"}
        </p>
        <h2 id="cash-paid-title" ref={resultHeading} tabIndex={-1}>
          {review.payment.method === "CASH"
            ? "Cash payment recorded"
            : review.payment.method === "CARD_MANUAL"
              ? "Card payment recorded manually"
              : "GCash payment recorded manually"}
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
          {review.payment.method === "CASH" && (
            <div className="cashier-cash-change">
              <dt>Change due</dt>
              <dd>{formatCartPrice(review.payment.changeDue)}</dd>
            </div>
          )}
          {review.payment.reference && (
            <div>
              <dt>Reference note / number</dt>
              <dd>{review.payment.reference}</dd>
            </div>
          )}
        </dl>
        <p>
          {review.payment.method === "CARD_MANUAL"
            ? "The cashier recorded this payment after checking completion on the external terminal. No gateway verification was performed."
            : review.payment.method === "GCASH_MANUAL"
              ? "The cashier recorded this payment after checking GCash receipt. No gateway verification was performed."
              : recordedHere
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
          <label htmlFor="payment-method">Payment method</label>
          <select
            id="payment-method"
            value={method}
            disabled={busy || blocked || confirm}
            onChange={(event) => {
              setMethod(
                event.target.value as "CASH" | "GCASH_MANUAL" | "CARD_MANUAL",
              );
              setAmount("");
              setReceivedConfirmed(false);
              setReference("");
              attempt.current = null;
            }}
          >
            <option value="CASH">Cash</option>
            <option value="GCASH_MANUAL">GCash (manual)</option>
            <option value="CARD_MANUAL">Card (manual)</option>
          </select>
          {manual ? (
            <>
              <p>
                {card
                  ? `Check that ${formatCartPrice(review.order.totalPrice)} was successfully paid through the external terminal or manual card process before recording payment.`
                  : `Check that ${formatCartPrice(review.order.totalPrice)} was received in the shop’s GCash account before recording payment.`}
              </p>
              <p>
                This records the cashier’s confirmation. No gateway verification
                is performed.
              </p>
              <label htmlFor="gcash-reference">
                Reference note / number (optional)
              </label>
              <input
                id="gcash-reference"
                value={reference}
                maxLength={200}
                autoComplete="off"
                disabled={busy || blocked || confirm}
                aria-invalid={invalidReference}
                aria-describedby={
                  invalidReference
                    ? "gcash-reference-hint gcash-reference-error"
                    : "gcash-reference-hint"
                }
                onChange={(event) => {
                  setReference(event.target.value);
                  attempt.current = null;
                }}
              />
              <p id="gcash-reference-hint">
                {card
                  ? "Up to 200 characters. Use a terminal receipt/reference; do not enter card numbers or security codes."
                  : "Up to 200 characters. Recorded as a cashier note."}
              </p>
              {invalidReference && (
                <InlineMessage id="gcash-reference-error">
                  Enter a plain-text reference of up to 200 characters.
                </InlineMessage>
              )}
              <label className="cashier-gcash-confirm">
                <input
                  type="checkbox"
                  checked={receivedConfirmed}
                  disabled={busy || blocked || confirm}
                  onChange={(event) => {
                    setReceivedConfirmed(event.target.checked);
                    attempt.current = null;
                  }}
                />
                {card
                  ? "I verified the full card payment completed through the external terminal/manual process."
                  : "I verified the full payment was received via GCash."}
              </label>
            </>
          ) : (
            <>
              <label htmlFor="cash-amount">Amount received (PHP)</label>
              <div className="cashier-cash-input">
                <span className="cashier-cash-currency" aria-hidden="true">
                  ₱
                </span>
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
                <strong>
                  {change === null ? "—" : formatCartPrice(change)}
                </strong>
              </div>
            </>
          )}
          <button
            className="primary-button"
            disabled={busy || blocked || confirm || !eligible}
            onClick={() => void refresh(true)}
          >
            {recordLabel}
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
      {busy && <p role="status">Checking or recording payment…</p>}
      {error && <InlineMessage>{error}</InlineMessage>}
      <DecisionDialog
        open={confirm}
        title={
          card
            ? "Record manual card payment?"
            : gcash
              ? "Record manual GCash payment?"
              : "Record cash payment?"
        }
        description={
          card && review
            ? `Record ${formatCartPrice(review.order.totalPrice)} paid by card for ${review.order.orderNumber}? Only continue after checking successful completion on the external terminal/manual process.`
            : gcash && review
              ? `Record ${formatCartPrice(review.order.totalPrice)} received via GCash for ${review.order.orderNumber}? Only continue after verifying receipt in the shop’s GCash account.`
              : review && normalized && change !== null
                ? `Record ${formatCartPrice(normalized)} received for ${review.order.orderNumber}, with ${formatCartPrice(change)} change due? Only continue once the cash is in hand.`
                : "Check the cash before recording payment."
        }
        confirmLabel={recordLabel}
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
      paymentMethod={method}
    >
      {controls}
    </CashierOrderReview>
  ) : (
    <section className="scanner-panel" aria-label="Order payment">
      <h2>{manual ? recordLabel : "Collect cash"}</h2>
      {controls}
      <button className="secondary-button" onClick={onNext} disabled={busy}>
        Scan another order
      </button>
    </section>
  );
}
