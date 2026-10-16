import { useId, useState } from "react";
import { FiRotateCw } from "react-icons/fi";
import type { CustomerOrderQr as QrCredential } from "../../features/cart/customer-order-qr";
import { CustomerOrderQr } from "./CustomerOrderQr";
import { OrderNumber } from "./OrderNumber";

export function OrderReferenceCard({
  credential,
  orderNumber,
}: {
  credential: QrCredential | null;
  orderNumber: string | null;
}) {
  const [showNumber, setShowNumber] = useState(false);
  const id = useId();
  return (
    <div
      className="order-reference-card"
      role="group"
      aria-label="Order reference card"
    >
      <p className="order-reference-number">
        {`Order number: ${orderNumber ?? "Unavailable"}`}
      </p>
      <div className="order-reference-perspective">
        <div
          className={`order-reference-turn${showNumber ? " is-flipped" : ""}`}
        >
          <div
            id={`${id}-qr`}
            className="order-reference-face order-reference-front"
            inert={showNumber}
            aria-hidden={showNumber}
          >
            <CustomerOrderQr credential={credential} compact />
          </div>
          <div
            id={`${id}-number`}
            className="order-reference-face order-reference-back"
            inert={!showNumber}
            aria-hidden={!showNumber}
          >
            <OrderNumber value={orderNumber} compact />
          </div>
        </div>
      </div>
      <div className="order-reference-toolbar">
        <span className="order-reference-side" aria-hidden="true">
          <span className={!showNumber ? "is-current" : ""} />{" "}
          <span className={showNumber ? "is-current" : ""} />
          {showNumber ? "Order number" : "QR code"}
        </span>
        <button
          type="button"
          className="secondary-button order-reference-flip"
          aria-controls={`${id}-qr ${id}-number`}
          onClick={() => setShowNumber((value) => !value)}
        >
          <FiRotateCw aria-hidden="true" />{" "}
          {showNumber ? "Show QR code" : "Show order number"}
        </button>
      </div>
      {showNumber && (
        <p className="order-reference-hint">
          {orderNumber
            ? "Tell the counter staff this number if your QR cannot be scanned."
            : "Ask the counter staff for help with your submitted order."}
        </p>
      )}
    </div>
  );
}
