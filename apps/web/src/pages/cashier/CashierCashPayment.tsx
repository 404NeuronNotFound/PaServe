import { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { FiCheckCircle } from "react-icons/fi";
import type {
  ApiErrorResponse,
  CashPaymentReviewResponse,
  VerifyOrderQrResponse,
} from "@paserve/contracts";
import {
  PAYMENT_REFERENCE_PATTERN,
  CASH_AMOUNT_MAX,
  isSafeOtherPaymentText,
  isSafeManualCardReference,
} from "@paserve/contracts";
import {
  reviewCashPayment,
  collectCashPayment,
  recordManualGcashPayment,
  recordManualCardPayment,
  recordOtherPayment,
  createPayment,
  normalizeCashAmount,
  cashChange,
} from "../../features/cashier/cash-payment";
import { CashierOrderReview } from "./CashierOrderReview";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { DecisionDialog } from "../../components/feedback/DecisionDialog";
import { formatCartPrice } from "../../lib/money";
import {
  verifyScannedOrder,
  lookupOrderNumber,
} from "../../features/cashier/order-qr";

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
  pendingOrder,
  qrToken = "",
}: {
  shopId: string;
  orderId: string;
  onNext: () => void;
  initialMethod?: "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER";
  pendingOrder?: VerifyOrderQrResponse["order"];
  qrToken?: string;
}) {
  const [review, setReview] = useState<CashPaymentReviewResponse | null>(
    pendingOrder ? { order: pendingOrder, payment: null } : null,
  );
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(initialMethod);
  const [receivedConfirmed, setReceivedConfirmed] = useState(false);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
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
  const other = method === "OTHER";
  const manual = method !== "CASH";
  const paymentLabel = other
    ? "Record other payment"
    : card
      ? "Record card payment"
      : gcash
        ? "Record GCash payment"
        : "Record cash payment";
  const recordLabel = pendingOrder ? "Confirm and pay" : paymentLabel;
  const invalidReference =
    !PAYMENT_REFERENCE_PATTERN.test(reference) ||
    (card && !isSafeManualCardReference(reference)) ||
    (other && !isSafeOtherPaymentText(reference));
  const invalidDescription =
    other && (!description.trim() || !isSafeOtherPaymentText(description, 80));
  const eligible = manual
    ? receivedConfirmed && !invalidReference && !invalidDescription
    : normalized !== null && change !== null;
  const loadReview = useCallback(
    async (signal: AbortSignal): Promise<CashPaymentReviewResponse> => {
      if (!pendingOrder) return reviewCashPayment(shopId, orderId, signal);
      try {
        const order = qrToken
          ? await verifyScannedOrder(shopId, qrToken, signal)
          : await lookupOrderNumber(shopId, pendingOrder.orderNumber, signal);
        return { order, payment: null };
      } catch (error) {
        if (signal.aborted) throw error;
        // A consumed QR after an uncertain save can only recover a saved paid receipt.
        try {
          const saved = await reviewCashPayment(shopId, orderId, signal);
          if (saved.payment) return saved;
        } catch {
          /* keep the reference failure */
        }
        throw error;
      }
    },
    [pendingOrder, qrToken, shopId, orderId],
  );
  useEffect(() => {
    active.current = true;
    const request = new AbortController();
    controller.current = request;
    void loadReview(request.signal)
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
  }, [loadReview]);
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
      const saved = await loadReview(request.signal);
      if (!active.current || request.signal.aborted) return;
      setReview(saved);
      setBlocked(false);
      if (review && saved.order.reviewVersion !== review.order.reviewVersion) {
        setAmount("");
        setReceivedConfirmed(false);
        attempt.current = null;
        if (!saved.payment)
          setError(
            other
              ? "The order changed. Review the saved total and verify the shop-specific payment again."
              : card
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
      const manualDto = {
        requestId: attempt.current,
        reviewVersion: review.order.reviewVersion,
        receivedConfirmed: true as const,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      };
      const saved = pendingOrder
        ? await createPayment(
            shopId,
            orderId,
            {
              requestId: attempt.current,
              reviewVersion: review.order.reviewVersion,
              method,
              ...(qrToken
                ? { qrToken }
                : { orderNumber: review.order.orderNumber }),
              ...(method === "CASH"
                ? { amountReceived: normalized! }
                : {
                    receivedConfirmed: true as const,
                    ...(reference.trim()
                      ? { reference: reference.trim() }
                      : {}),
                    ...(other ? { description: description.trim() } : {}),
                  }),
            },
            request.signal,
          )
        : other
          ? await recordOtherPayment(
              shopId,
              orderId,
              { ...manualDto, description: description.trim() },
              request.signal,
            )
          : manual
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
          {review.payment.method === "OTHER"
            ? "OTHER"
            : review.payment.method === "CASH"
              ? "CASH"
              : review.payment.method === "CARD_MANUAL"
                ? "CARD MANUAL"
                : "GCASH MANUAL"}
        </p>
        <h2 id="cash-paid-title" ref={resultHeading} tabIndex={-1}>
          {review.payment.method === "OTHER"
            ? "Other payment recorded manually"
            : review.payment.method === "CASH"
              ? "Cash payment recorded"
              : review.payment.method === "CARD_MANUAL"
                ? "Card payment recorded manually"
                : "GCash payment recorded manually"}
        </h2>
        <p role="status">{review.order.orderNumber} is paid.</p>
        {review.queue && (
          <p role="status">
            {review.queue.status === "QUEUED"
              ? "Queued for preparation."
              : review.queue.status === "PREPARING"
                ? "Preparation is in progress."
                : review.queue.status === "COMPLETED"
                  ? "Order fulfilled."
                  : "Ready for collection."}
          </p>
        )}
        <dl>
          {review.payment.description && (
            <div>
              <dt>Payment method description</dt>
              <dd>{review.payment.description}</dd>
            </div>
          )}
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
          {review.payment.method === "OTHER"
            ? "The cashier recorded full payment using the shop-specific method shown above. No gateway verification was performed."
            : review.payment.method === "CARD_MANUAL"
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
                event.target.value as
                  "CASH" | "GCASH_MANUAL" | "CARD_MANUAL" | "OTHER",
              );
              setAmount("");
              setReceivedConfirmed(false);
              setReference("");
              setDescription("");
              attempt.current = null;
            }}
          >
            <option value="CASH">Cash</option>
            <option value="GCASH_MANUAL">GCash (manual)</option>
            <option value="CARD_MANUAL">Card (manual)</option>
            <option value="OTHER">Other (manual)</option>
          </select>
          {manual ? (
            <>
              {other && (
                <>
                  <label htmlFor="other-payment-description">
                    Payment method description
                  </label>
                  <input
                    id="other-payment-description"
                    value={description}
                    maxLength={80}
                    required
                    disabled={busy || blocked || confirm}
                    aria-invalid={description.length > 0 && invalidDescription}
                    aria-describedby={
                      description.length > 0 && invalidDescription
                        ? "other-payment-description-hint other-payment-description-error"
                        : "other-payment-description-hint"
                    }
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setReceivedConfirmed(false);
                      attempt.current = null;
                    }}
                  />
                  <p id="other-payment-description-hint">
                    Required. Up to 80 characters, such as Bank transfer or Shop
                    voucher. Use Cash, GCash or Card for those methods. Do not
                    enter card details.
                  </p>
                  {description.length > 0 && invalidDescription && (
                    <InlineMessage id="other-payment-description-error">
                      Enter a plain-text method description of up to 80
                      characters without card details.
                    </InlineMessage>
                  )}
                </>
              )}
              <p>
                {other
                  ? `Check that the full ${formatCartPrice(review.order.totalPrice)} was received using the described shop-specific method before recording payment.`
                  : card
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
                  {other || card
                    ? "Use a receipt reference of up to 200 characters without card details."
                    : "Enter a plain-text reference of up to 200 characters."}
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
                {other
                  ? "I verified the full payment was received using this shop-specific method."
                  : card
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
                  maxLength={CASH_AMOUNT_MAX.length}
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
                Enter the cash actually received, with up to two decimal places.
                It must cover the total. Maximum{" "}
                {formatCartPrice(CASH_AMOUNT_MAX)}.
              </p>
              {invalidAmount && (
                <InlineMessage id="cash-amount-error">
                  {normalized
                    ? "The amount received is below the order total."
                    : `Enter a valid amount with up to two decimal places. Maximum ${formatCartPrice(CASH_AMOUNT_MAX)}.`}
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
          pendingOrder
            ? "Confirm and pay?"
            : other
              ? "Record other payment?"
              : card
                ? "Record manual card payment?"
                : gcash
                  ? "Record manual GCash payment?"
                  : "Record cash payment?"
        }
        description={
          (pendingOrder
            ? "Confirm this order and record payment together. "
            : "") +
          (other && review
            ? `Record ${formatCartPrice(review.order.totalPrice)} received using ${description.trim()} for ${review.order.orderNumber}? Only continue after verifying the full payment.`
            : card && review
              ? `Record ${formatCartPrice(review.order.totalPrice)} paid by card for ${review.order.orderNumber}? Only continue after checking successful completion on the external terminal/manual process.`
              : gcash && review
                ? `Record ${formatCartPrice(review.order.totalPrice)} received via GCash for ${review.order.orderNumber}? Only continue after verifying receipt in the shop’s GCash account.`
                : review && normalized && change !== null
                  ? `Record ${formatCartPrice(normalized)} received for ${review.order.orderNumber}, with ${formatCartPrice(change)} change due? Only continue once the cash is in hand.`
                  : "Check the cash before recording payment.")
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
      confirming={!!pendingOrder}
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
