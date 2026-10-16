import { useId } from "react";
import { formatReceiptDateTime, RECEIPT_LOCALE, RECEIPT_TIME_ZONE } from "../../lib/receipt-date-time";

export function ReceiptTimestamps({ createdAt, paidAt, completedAt, paid }: {
  createdAt?: string; paidAt?: string | null; completedAt?: string | null; paid: boolean;
}) {
  const title = useId();
  return (
    <section className="receipt-timestamps" aria-labelledby={title}>
      <h2 id={title}>Date / Time</h2>
      <p>Timezone: {RECEIPT_TIME_ZONE} · {RECEIPT_LOCALE}</p>
      <dl>
        <div><dt>Order placed</dt><dd>{createdAt ? <time dateTime={createdAt}>{formatReceiptDateTime(createdAt)}</time> : "Unavailable in this saved receipt"}</dd></div>
        {(paid || paidAt) && <div><dt>Payment recorded</dt><dd>{paidAt ? <time dateTime={paidAt}>{formatReceiptDateTime(paidAt)}</time> : "Unavailable in this saved receipt"}</dd></div>}
        {completedAt && <div><dt>Completion time</dt><dd><time dateTime={completedAt}>{formatReceiptDateTime(completedAt)}</time></dd></div>}
      </dl>
    </section>
  );
}
