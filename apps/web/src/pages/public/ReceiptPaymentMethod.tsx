import { useId } from "react";
import type { ReceiptPaymentDetails } from "@paserve/contracts";
import { formatCartPrice } from "../../lib/money";

const labels: Record<ReceiptPaymentDetails["method"], string> = {
  CASH: "Cash", GCASH_MANUAL: "GCash (manual)", CARD_MANUAL: "Card (manual)", OTHER: "Other",
};
export function ReceiptPaymentMethod({ payment, confirmed }: {
  payment?: ReceiptPaymentDetails | null;
  confirmed: boolean;
}) {
  const title = useId();
  return (
    <section className="receipt-payment-method" aria-labelledby={title}>
      <h2 id={title}>Payment method</h2>
      {payment ? (
        <>
          <p className="receipt-payment-label">{labels[payment.method]}</p>
          {payment.method === "CASH" && <p>{payment.amountReceived !== undefined
            ? `Amount received (PHP): ${formatCartPrice(payment.amountReceived)}`
            : "Amount received is unavailable in this saved receipt."}</p>}
          {payment.method === "CASH" && <p>{payment.changeDue !== undefined
            ? `Change (PHP): ${formatCartPrice(payment.changeDue)}`
            : "Change is unavailable in this saved receipt."}</p>}
          {payment.description && <p>Method details: {payment.description}</p>}
          {payment.reference && <p>{payment.method === "GCASH_MANUAL" ? "GCash reference" : payment.method === "CARD_MANUAL" ? "Card receipt reference" : "Payment reference"}: {payment.reference}</p>}
        </>
      ) : <p>{confirmed ? "The recorded payment method is unavailable." : "No payment method has been recorded."}</p>}
    </section>
  );
}
