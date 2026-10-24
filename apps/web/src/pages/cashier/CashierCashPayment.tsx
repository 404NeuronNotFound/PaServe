import { RefreshButton } from "../../components/feedback/RefreshButton";
import { FormField } from "../../components/forms/FormField";
import { useDraftGuard } from "../../app/router/useDraftGuard";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";
import { PendingButton } from "../../components/feedback/PendingButton";
import { useCallback, useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import {
  FiArrowRight,
  FiCheckCircle,
  FiFileText,
  FiInfo,
  FiPackage,
} from "react-icons/fi";
import type {
  ApiErrorResponse,
  CashPaymentReviewResponse,
  VerifyOrderQrResponse,
} from "@paserve/contracts";
import { CashierPaidReceipt } from "./CashierPaidReceipt";
import {
  formatReceiptDateTime,
  RECEIPT_TIME_ZONE,
} from "../../lib/receipt-date-time";
import {
  PAYMENT_REFERENCE_PATTERN,
  CASH_AMOUNT_MAX,
  isSafeOtherPaymentText,
  isSafeManualCardReference,
  parseReceiptPaymentDetails,
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
import { verifyScannedOrder } from "../../features/cashier/order-qr";
import { useConfirmedOrderEvents } from "../../features/orders/useConfirmedOrderEvents";

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
  const [pendingAction, setPendingAction] = useState<
    "refresh" | "review" | "record"
  >("refresh");
  const [blocked, setBlocked] = useState(true);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [recordedHere, setRecordedHere] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const active = useRef(false),
    running = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<string | null>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  useDraftGuard(
    !review?.payment &&
      Boolean(amount || reference || description || receivedConfirmed),
    busy && pendingAction === "record",
  );
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
      const saved = await reviewCashPayment(shopId, orderId, signal);
      // A saved paid receipt is the source of truth after an uncertain write.
      // Pending QR workflows still verify their credential before another write.
      if (saved.payment) return saved;
      if (!pendingOrder) {
        if (saved.order.status === "PENDING_CONFIRMATION")
          throw new Error("This order is awaiting confirmation. Scan another order and reopen it by number to confirm and pay.");
        return saved;
      }
      if (saved.order.status !== "PENDING_CONFIRMATION")
        throw new Error("This order was confirmed elsewhere. Scan another order and reopen it by number to review payment.");
      if (qrToken) {
        const order = await verifyScannedOrder(shopId, qrToken, signal);
        return { order, payment: null };
      }
      return saved;
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
          if (saved.payment) setConfirm(false);
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
  }, [review?.payment, showReceipt]);
  async function refresh(open = false) {
    if (running.current || busy) return;
    running.current = true;
    setBusy(true);
    setPendingAction(open ? "review" : "refresh");
    setError("");
    const request = new AbortController();
    controller.current = request;
    try {
      const saved = await loadReview(request.signal);
      if (!active.current || request.signal.aborted) return;
      setReview(saved);
      setBlocked(false);
      if (saved.payment) setConfirm(false);
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
        setShowReceipt(false);
        setError(failureMessage(error));
      }
    } finally {
      running.current = false;
      if (active.current && !request.signal.aborted) setBusy(false);
    }
  }
  useConfirmedOrderEvents(
    shopId,
    orderId,
    () => {
      void refresh();
    },
    busy,
  );
  async function collect() {
    if (running.current || blocked || !review || !eligible) return;
    running.current = true;
    setBusy(true);
    setPendingAction("record");
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
  const receiptPayment = parseReceiptPaymentDetails(review?.payment);
  if (
    showReceipt &&
    !blocked &&
    review?.payment &&
    review.order.status === "CONFIRMED" &&
    review.order.paymentStatus === "PAID"
  )
    return (
      <CashierPaidReceipt
        review={review}
        validating={busy}
        onBack={() => setShowReceipt(false)}
      />
    );
  if (review?.payment)
    return (
      <section
        className="scanner-panel cashier-cash-result"
        aria-labelledby="cash-paid-title"
      >
        <header className="cashier-paid-header">
          <div className="cashier-paid-heading">
            <p className="section-label">Payment complete</p>
            <h2 id="cash-paid-title" ref={resultHeading} tabIndex={-1}>
              {review.payment.method === "OTHER"
                ? "Other payment recorded manually"
                : review.payment.method === "CASH"
                  ? "Cash payment recorded"
                  : review.payment.method === "CARD_MANUAL"
                    ? "Card payment recorded manually"
                    : "GCash payment recorded manually"}
            </h2>
            <p className="cashier-paid-order" role="status">
              {review.order.orderNumber} is paid.
            </p>
          </div>
          <span className="cashier-cash-emblem" aria-hidden="true">
            <FiCheckCircle aria-hidden="true" />
          </span>
        </header>
        <div className="cashier-paid-body">
          <div className="cashier-paid-context">
            <span className="cashier-paid-method">
              <FiFileText aria-hidden="true" />
              {review.payment.method === "OTHER"
                ? "Other payment"
                : review.payment.method === "CASH"
                  ? "Cash"
                  : review.payment.method === "CARD_MANUAL"
                    ? "Card · Manual"
                    : "GCash · Manual"}
            </span>
            {review.queue && (
              <p className="cashier-paid-fulfillment" role="status">
                <FiPackage aria-hidden="true" />
                {review.queue.status === "QUEUED"
                  ? "Queued for preparation."
                  : review.queue.status === "PREPARING"
                    ? "Preparation is in progress."
                    : review.queue.status === "COMPLETED"
                      ? "Order fulfilled."
                      : "Ready for collection."}
              </p>
            )}
          </div>
          <dl>
            <div className="cashier-paid-total">
              <dt>Order total</dt>
              <dd>{formatCartPrice(review.order.totalPrice)}</dd>
            </div>
            <div>
              <dt>Payment recorded ({RECEIPT_TIME_ZONE})</dt>
              <dd>
                <time dateTime={review.payment.paidAt}>
                  {formatReceiptDateTime(review.payment.paidAt)}
                </time>
              </dd>
            </div>
            {receiptPayment?.description && (
              <div>
                <dt>Payment method description</dt>
                <dd>{receiptPayment.description}</dd>
              </div>
            )}
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
            {receiptPayment?.reference && (
              <div>
                <dt>Reference note / number</dt>
                <dd>{receiptPayment.reference}</dd>
              </div>
            )}
          </dl>
          <div className="cashier-paid-note receipt-screen-only">
            <FiInfo aria-hidden="true" />
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
          </div>
          {error && <InlineMessage>{error}</InlineMessage>}
          <div className="cashier-paid-actions">
            {blocked && (
              <RefreshButton
                label="Refresh payment"
                pending={busy && pendingAction === "refresh"}
                pendingLabel="Refreshing payment..."
                disabled={busy}
                onClick={() => void refresh()}
              />
            )}
            {!blocked &&
              review.order.status === "CONFIRMED" &&
              review.order.paymentStatus === "PAID" && (
                <Button
                  variant="outline"
                  size="inherit"
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => setShowReceipt(true)}
                >
                  <FiFileText aria-hidden="true" /> View receipt
                </Button>
              )}
            <Button
              variant="default"
              size="inherit"
              type="submit"
              className="primary-button"
              onClick={onNext}
            >
              Scan another order <FiArrowRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>
    );
  const refreshControl = (
    <RefreshButton
      label="Refresh payment"
      pending={busy && pendingAction === "refresh"}
      pendingLabel="Refreshing payment..."
      disabled={busy || confirm}
      onClick={() => void refresh()}
    />
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
                  <FormField
                    id="other-payment-description"
                    label="Payment method description"
                    required
                    hint={
                      <>
                        {" "}
                        Required. Up to 80 characters, such as Bank transfer or
                        Shop voucher. Use Cash, GCash or Card for those methods.
                        Do not enter card details.{" "}
                      </>
                    }
                    error={
                      description.length > 0 && invalidDescription
                        ? "Enter a plain-text method description of up to 80 characters without card details."
                        : undefined
                    }
                  >
                    <Input
                      id="other-payment-description"
                      value={description}
                      maxLength={80}
                      required
                      disabled={busy || blocked || confirm}
                      aria-invalid={
                        description.length > 0 && invalidDescription
                      }
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
                  </FormField>
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
              <FormField
                id="gcash-reference"
                label="Reference note / number (optional)"
                hint={
                  <>
                    {" "}
                    {card
                      ? "Up to 200 characters. Use a terminal receipt/reference; do not enter card numbers or security codes."
                      : "Up to 200 characters. Recorded as a cashier note."}{" "}
                  </>
                }
                error={
                  invalidReference
                    ? other || card
                      ? "Use a receipt reference of up to 200 characters without card details."
                      : "Enter a plain-text reference of up to 200 characters."
                    : undefined
                }
              >
                <Input
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
              </FormField>
              <label className="cashier-gcash-confirm">
                <Input
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
              <FormField
                id="cash-amount"
                label="Amount received (PHP)"
                required
                hint={
                  <>
                    Enter the cash actually received, with up to two decimal
                    places. It must cover the total. Maximum{" "}
                    {formatCartPrice(CASH_AMOUNT_MAX)}.
                  </>
                }
                error={
                  invalidAmount
                    ? normalized
                      ? "The amount received is below the order total."
                      : `Enter a valid amount with up to two decimal places. Maximum ${formatCartPrice(CASH_AMOUNT_MAX)}.`
                    : undefined
                }
              >
                <div className="cashier-cash-input">
                  <span className="cashier-cash-currency" aria-hidden="true">
                    ₱
                  </span>
                  <Input
                    id="cash-amount"
                    ref={amountInput}
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
              </FormField>
              <div
                className="cashier-tender-shortcuts"
                role="group"
                aria-label="Cash amount shortcuts"
              >
                <p>
                  Choose the cash actually handed over. You can edit the amount.
                </p>
                {[
                  review.order.totalPrice,
                  ...["100.00", "200.00", "500.00", "1000.00"].filter(
                    (value) => {
                      const difference = cashChange(
                        value,
                        review.order.totalPrice,
                      );
                      return difference !== null && difference !== "0.00";
                    },
                  ),
                ].map((value, index) => (
                  <Button
                    key={value}
                    variant="outline"
                    disabled={busy || blocked || confirm}
                    onClick={() => {
                      setAmount(value);
                      attempt.current = null;
                      amountInput.current?.focus();
                    }}
                  >
                    {index === 0
                      ? `Exact ${formatCartPrice(value)}`
                      : formatCartPrice(value)}
                  </Button>
                ))}
              </div>
              <div className="cashier-cash-change" role="status">
                <span>Change due</span>
                <strong>
                  {change === null ? "—" : formatCartPrice(change)}
                </strong>
              </div>
            </>
          )}
          <PendingButton
            pending={busy && pendingAction === "review"}
            pendingLabel="Checking payment..."
            className="primary-button"
            disabled={busy || blocked || confirm || !eligible}
            onClick={() => void refresh(true)}
          >
            {recordLabel}
          </PendingButton>
        </>
      )}
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
        pendingLabel={
          pendingOrder ? "Confirming payment…" : "Recording payment…"
        }
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
      refresh={{
        label: "Refresh payment",
        pending: busy && pendingAction === "refresh",
        disabled: busy || confirm,
        onClick: () => {
          void refresh();
        },
      }}
    >
      {controls}
    </CashierOrderReview>
  ) : (
    <section className="scanner-panel" aria-label="Order payment">
      <div className="cashier-summary-toolbar">
        <h2>{manual ? recordLabel : "Collect cash"}</h2>
        {refreshControl}
      </div>
      {controls}
      <Button
        variant="outline"
        size="inherit"
        type="submit"
        className="secondary-button"
        onClick={onNext}
        disabled={busy}
      >
        Scan another order
      </Button>
    </section>
  );
}
