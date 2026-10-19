import { useRef, useState } from "react";
import { FiCopy } from "react-icons/fi";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import { feedback } from "../../app/stores/feedback";

export function OrderNumber({
  value,
  compact = false,
}: {
  value: string | null;
  compact?: boolean;
}) {
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  async function copy() {
    if (!value || busy.current) return;
    busy.current = true;
    setCopying(true);
    setError("");
    try {
      await navigator.clipboard.writeText(value);
      feedback.toast("Order number copied.");
    } catch {
      setError(
        "Could not copy. Select the order number to copy it manually, or read it to the staff.",
      );
    } finally {
      busy.current = false;
      setCopying(false);
    }
  }

  return (
    <section
      className="order-receipt-number"
      aria-labelledby="order-number-title"
    >
      <h2 id="order-number-title">Order number</h2>
      <div className="order-receipt-number-row">
        <p className="order-receipt-number-value">{value ?? "Unavailable"}</p>
        {value && (
          <button
            aria-busy={copying}
            className="secondary-button"
            type="button"
            disabled={copying}
            onClick={() => void copy()}
          >
            <FiCopy aria-hidden="true" />
            {copying ? "Copying…" : "Copy order number"}
          </button>
        )}
      </div>
      {!compact && (
        <p className="order-receipt-number-hint">
          {value
            ? "Tell the counter staff this number if your QR cannot be scanned."
            : "Ask the counter staff for help with your submitted order."}
        </p>
      )}
      {error && <InlineMessage tone="error">{error}</InlineMessage>}
    </section>
  );
}
