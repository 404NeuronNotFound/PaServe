import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import {
  FiCamera,
  FiUpload,
  FiArrowRight,
  FiHash,
  FiChevronDown,
  FiMaximize,
  FiShield,
  FiPause,
} from "react-icons/fi";
import type {
  ApiErrorResponse,
  VerifyOrderQrResponse,
} from "@paserve/contracts";
import {
  parseOrderQr,
  verifyScannedOrder,
  lookupOrderNumber,
} from "../../features/cashier/order-qr";
import { readQrImage } from "../../features/cashier/qr-decoder";
import {
  cameraUnavailableReason,
  useQrCamera,
} from "../../features/cashier/useQrCamera";
import { SelectField } from "../../components/forms/SelectField";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { CashierOrderDecision } from "./CashierOrderDecision";
import { CashierCashPayment } from "./CashierCashPayment";
import { lookupCashPayment } from "../../features/cashier/cash-payment";
import "./scanner.css";

export function OrderQrScanner({ shopId }: { shopId: string }) {
  const mounted = useRef(false);
  const processing = useRef(false);
  const request = useRef<AbortController | null>(null);
  const lastCode = useRef("");
  const [reviewToken, setReviewToken] = useState("");
  const scannerHeading = useRef<HTMLHeadingElement>(null);
  const wasReviewing = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pasted, setPasted] = useState("");
  const [number, setNumber] = useState("");
  const [paymentOrderId, setPaymentOrderId] = useState("");
  const [lostAccess, setLostAccess] = useState(false);
  const [expiredSession, setExpiredSession] = useState(false);
  const [order, setOrder] = useState<VerifyOrderQrResponse["order"] | null>(
    null,
  );
  const {
    videoRef,
    phase,
    error: cameraError,
    cameras,
    deviceId,
    start: startCamera,
    stop: stopCamera,
  } = useQrCamera(scan);
  const unavailable = cameraUnavailableReason();
  useEffect(() => {
    if (!order && wasReviewing.current) scannerHeading.current?.focus();
    wasReviewing.current = Boolean(order);
  }, [order]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  function scan(raw: string): boolean {
    if (processing.current || lostAccess || order) return true;
    const reference = parseOrderQr(raw);
    if (!reference || reference.shopId !== shopId) {
      if (lastCode.current !== raw.slice(0, 1025)) {
        lastCode.current = raw.slice(0, 1025);
        setError(
          reference
            ? "This order QR belongs to another shop. Scan an order for the active shop."
            : "This is not a PaServe order QR. Use the customer's order QR, rather than a table QR or order number.",
        );
      }
      return false;
    }
    processing.current = true;
    stopCamera();
    setBusy(true);
    setError("");
    setOrder(null);
    setPasted("");
    lastCode.current = "";
    load(
      (controller) =>
        verifyScannedOrder(shopId, reference.qrToken, controller.signal),
      reference.qrToken,
    );
    return true;
  }
  function load(
    fetchOrder: (
      controller: AbortController,
    ) => Promise<VerifyOrderQrResponse["order"]>,
    token: string,
  ) {
    const controller = new AbortController();
    request.current = controller;
    void fetchOrder(controller)
      .then((saved) => {
        if (mounted.current && !controller.signal.aborted) {
          setReviewToken(token);
          setNumber("");
          setOrder(saved);
        }
      })
      .catch((failure: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        if (isAxiosError<ApiErrorResponse>(failure)) {
          const status = failure.response?.status;
          if (
            status === 401 ||
            (status === 403 &&
              failure.response?.data?.code !== "ORDER_TOKEN_INVALID")
          ) {
            setLostAccess(true);
            setExpiredSession(status === 401);
            setError(
              status === 401
                ? "Your session expired. Sign in again before scanning."
                : "Your cashier access is no longer available. Choose another shop or ask its owner for access.",
            );
          } else
            setError(
              typeof failure.response?.data?.message === "string"
                ? failure.response.data.message
                : "Unable to verify the order. Check your connection and try again.",
            );
        } else
          setError(
            failure instanceof Error
              ? failure.message
              : "Unable to verify the order. Please try again.",
          );
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) {
          processing.current = false;
          request.current = null;
          setBusy(false);
        }
      });
  }
  function findNumber(event: FormEvent) {
    event.preventDefault();
    if (processing.current || lostAccess || order) return;
    processing.current = true;
    stopCamera();
    setBusy(true);
    setError("");
    setPasted("");
    load(async (controller) => {
      try {
        return await lookupOrderNumber(shopId, number, controller.signal);
      } catch (failure) {
        if (
          !isAxiosError<ApiErrorResponse>(failure) ||
          failure.response?.status !== 409 ||
          failure.response.data?.code !== "ORDER_NOT_PENDING_CONFIRMATION"
        )
          throw failure;
        const saved = await lookupCashPayment(
          shopId,
          number,
          controller.signal,
        );
        if (mounted.current && !controller.signal.aborted)
          setPaymentOrderId(saved.order.id);
        return saved.order;
      }
    }, "");
  }
  function start(selected = "") {
    if (processing.current || lostAccess) return;
    setOrder(null);
    setError("");
    lastCode.current = "";
    void startCamera(selected);
  }
  function manual(event: FormEvent) {
    event.preventDefault();
    lastCode.current = "";
    scan(pasted);
  }
  async function image(file: File) {
    if (processing.current || lostAccess) return;
    processing.current = true;
    setBusy(true);
    setOrder(null);
    setError("");
    stopCamera();
    try {
      const raw = await readQrImage(file);
      if (!mounted.current) return;
      processing.current = false;
      lastCode.current = "";
      if (!scan(raw)) setBusy(false);
    } catch (failure) {
      if (mounted.current) {
        processing.current = false;
        setBusy(false);
        setError(
          failure instanceof Error
            ? failure.message
            : "Unable to read this image. Try a clearer image, or paste the QR contents.",
        );
      }
    }
  }
  if (paymentOrderId)
    return (
      <div className="cashier-review-screen">
        <CashierCashPayment
          key={paymentOrderId}
          shopId={shopId}
          orderId={paymentOrderId}
          onNext={() => {
            setPaymentOrderId("");
            setOrder(null);
            setReviewToken("");
            setError("");
            lastCode.current = "";
          }}
        />
      </div>
    );
  if (order) {
    return (
      <div className="cashier-review-screen">
        <CashierOrderDecision
          order={order}
          qrToken={reviewToken}
          onNext={() => {
            setReviewToken("");
            setOrder(null);
            setError("");
            lastCode.current = "";
          }}
        />
      </div>
    );
  }
  return (
    <div className="cashier-scanner">
      <section className="scanner-panel" aria-labelledby="scanner-title">
        <div className="scanner-panel-heading">
          <div>
            <p className="section-label">CAMERA SCAN</p>
            <h2 id="scanner-title" ref={scannerHeading} tabIndex={-1}>
              Scan customer order QR
            </h2>
          </div>
          <span
            className={`scanner-state${phase === "scanning" ? " is-live" : ""}`}
          >
            <span aria-hidden="true" />
            {busy
              ? "Verifying"
              : phase === "scanning"
                ? "Camera live"
                : phase === "starting"
                  ? "Connecting"
                  : "Standby"}
          </span>
        </div>
        <p className="scanner-description">
          One scan brings the customer's order into focus.
        </p>
        <div
          className={`scanner-preview${phase === "scanning" ? " is-active" : ""}`}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Order QR camera preview"
          />
          <div className="scanner-viewfinder" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          {phase !== "scanning" && (
            <div className="scanner-idle">
              <span className="scanner-camera-icon">
                <FiCamera aria-hidden="true" />
              </span>
              <strong>
                {busy
                  ? "Loading your order"
                  : phase === "starting"
                    ? "Waiting for camera access…"
                    : "Ready when you are"}
              </strong>
              <span>
                {busy
                  ? "Checking the saved order details."
                  : "Start the camera to scan a customer's QR."}
              </span>
            </div>
          )}
          <span className="scanner-preview-caption">
            <FiMaximize aria-hidden="true" /> Keep the QR inside the frame
          </span>
        </div>
        <div className="scanner-controls">
          <button
            className="primary-button"
            onClick={() => start()}
            disabled={
              busy || lostAccess || Boolean(unavailable) || phase !== "idle"
            }
          >
            <FiCamera aria-hidden="true" /> Start camera
          </button>
          <button
            className="secondary-button"
            onClick={stopCamera}
            disabled={phase === "idle"}
          >
            <FiPause aria-hidden="true" /> Stop camera
          </button>
        </div>
        {cameras.length > 1 && (
          <SelectField
            id="scanner-camera"
            label="Camera"
            value={deviceId}
            options={cameras.map((device, index) => ({
              value: device.deviceId,
              label: device.label || `Camera ${index + 1}`,
            }))}
            onChange={start}
            disabled={busy || lostAccess || phase === "starting"}
          />
        )}
        {(unavailable || cameraError) && (
          <InlineMessage tone="warning">
            {unavailable || cameraError}
          </InlineMessage>
        )}
        <p className="scanner-status" role="status">
          {busy
            ? "Reading and verifying the order QR…"
            : phase === "scanning"
              ? "Camera ready. Waiting for an order QR."
              : phase === "starting"
                ? "Allow camera access when your browser asks. You can stop or use the options below."
                : "Start the camera when you are ready, or use another scanning option."}
        </p>
        {error && <InlineMessage>{error}</InlineMessage>}
        {lostAccess && (
          <Link
            className="secondary-button"
            to={expiredSession ? "/login" : "/app/shops"}
            state={
              expiredSession
                ? { returnTo: `/app/shops/${shopId}/cashier` }
                : undefined
            }
          >
            {expiredSession ? "Sign in again" : "Choose another shop"}
          </Link>
        )}
      </section>
      <section
        className="scanner-panel scanner-fallback"
        aria-labelledby="scanner-fallback-title"
      >
        <p className="section-label">MANUAL LOOKUP</p>
        <h2 id="scanner-fallback-title">Have an order number?</h2>
        <p className="scanner-description">
          A quick way in when the QR isn't handy.
        </p>
        <form onSubmit={findNumber}>
          <div className="field">
            <label htmlFor="scanner-order-number">Find by order number</label>
            <div className="scanner-number-input">
              <FiHash aria-hidden="true" />
              <input
                id="scanner-order-number"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="ORD-000006"
                maxLength={23}
                autoComplete="off"
                disabled={busy || lostAccess}
                aria-describedby="scanner-number-hint"
              />
            </div>
            <p id="scanner-number-hint">
              Use the number beneath the customer's QR.
            </p>
          </div>
          <button
            className="primary-button scanner-find"
            disabled={busy || lostAccess || !number.trim()}
          >
            Find order <FiArrowRight aria-hidden="true" />
          </button>
        </form>
        <div className="scanner-shop-note">
          <FiShield aria-hidden="true" />
          <span>Orders from your active shop only.</span>
        </div>
        <details className="scanner-more" open={unavailable ? true : undefined}>
          <summary>
            Other scanning options <FiChevronDown aria-hidden="true" />
          </summary>
          <div className="scanner-more-content">
            <div className="field">
              <label htmlFor="scanner-image">
                <FiUpload aria-hidden="true" /> Choose an order QR image
              </label>
              <input
                id="scanner-image"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy || lostAccess}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void image(file);
                }}
              />
              <p>PNG, JPEG or WebP · up to 10 MB. Read on this device.</p>
            </div>
            <form onSubmit={manual}>
              <div className="field">
                <label htmlFor="scanner-paste">Paste order QR contents</label>
                <textarea
                  id="scanner-paste"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  maxLength={1024}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={busy || lostAccess}
                />
                <p>
                  Paste the text encoded in the customer's order QR. For an
                  order number, use Find by order number above.
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={busy || lostAccess || !pasted.trim()}
              >
                Verify pasted QR
              </button>
            </form>
          </div>
        </details>
        <div className="scanner-handoff">
          <span className="section-label">THE COUNTER ROUTINE</span>
          <p>
            Find the order. Check it together.
            <br />
            Then make the call.
          </p>
          <span>Payment is handled separately.</span>
        </div>
      </section>
    </div>
  );
}
