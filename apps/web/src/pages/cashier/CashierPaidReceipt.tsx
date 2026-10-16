import { useEffect, useRef, useState } from "react";
import { parseReceiptPaymentDetails, type CashPaymentReviewResponse } from "@paserve/contracts";
import { FiArrowLeft, FiPrinter } from "react-icons/fi";
import { ReceiptDocument } from "../../components/shops/ReceiptDocument";
import { InlineMessage } from "../../components/feedback/InlineMessage";
import "../public/customer-order-page.css";
import "./receipt-print.css";

export function CashierPaidReceipt({ review, onBack, validating = false }: {
  review: CashPaymentReviewResponse;
  onBack: () => void;
  validating?: boolean;
}) {
  const [layout, setLayout] = useState("standard");
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  if (!review.payment || review.order.status !== "CONFIRMED" || review.order.paymentStatus !== "PAID") return null;
  function print() {
    if (validating) return;
    setError("");
    try { window.print(); }
    catch { setError("Could not open the print dialog. Try printing again."); }
  }
  return (
    <section className="cashier-receipt-view cashier-receipt-page" data-print-layout={layout} aria-labelledby="cashier-receipt-title">
      <header className="cashier-receipt-view-heading receipt-screen-only">
        <div><p className="section-label">Customer copy / Paid receipt</p><h2 id="cashier-receipt-title" ref={heading} tabIndex={-1}>Receipt {review.order.orderNumber}</h2></div>
        <button className="secondary-button" onClick={onBack}><FiArrowLeft aria-hidden="true" /> Back to payment</button>
      </header>
      <ReceiptDocument shopDetails={review.order.shopDetails} orderNumber={review.order.orderNumber}
        orderContext={review.order.mode === "DINE_IN" ? `Dine-in · Table ${review.order.tableNumber}` : "Takeout / pickup"}
        items={review.order.items} totalPrice={review.order.totalPrice}
        payment={parseReceiptPaymentDetails(review.payment)} paidAt={review.payment.paidAt} />
      <section className="receipt-print-controls" aria-label="Receipt printing">
        <label className="field">Print layout
          <select value={layout} onChange={(event) => setLayout(event.target.value)}>
            <option value="standard">Standard paper</option><option value="thermal-80">80 mm receipt</option><option value="thermal-58">58 mm receipt</option>
          </select>
        </label>
        <button type="button" className="primary-button" disabled={validating} onClick={print}><FiPrinter aria-hidden="true" /> Print receipt</button>
        {validating && <p role="status">Checking receipt access…</p>}
        <p>Choose the matching paper size in your printer settings. Turn off browser headers and footers to keep the page address off the receipt.</p>
        {error && <InlineMessage>{error}</InlineMessage>}
      </section>
    </section>
  );
}
