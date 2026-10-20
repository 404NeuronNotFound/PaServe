import type { IconType } from "react-icons";
export function MetricCard({
  id,
  title,
  value,
  note,
  Icon,
  number,
}: {
  id: string;
  title: string;
  value: string;
  note: string;
  Icon: IconType;
  number: string;
}) {
  return (
    <article className="sales-metric" aria-labelledby={id}>
      <div className="sales-metric-top">
        <span className="sales-metric-icon">
          <Icon aria-hidden="true" />
        </span>
        <span className="sales-metric-index" aria-hidden="true">
          {number}
        </span>
      </div>
      <h2 id={id}>{title}</h2>
      <strong className="sales-amount">{value}</strong>
      <p>{note}</p>
    </article>
  );
}

