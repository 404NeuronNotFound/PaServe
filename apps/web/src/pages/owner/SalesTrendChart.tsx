import { Input } from "../../components/ui/input";
import { useId, useState } from "react";
import type { SalesTrendPeriod } from "@paserve/contracts";
import { formatCartPrice } from "../../lib/money";

const cents = (value: string) => BigInt(value.replace(".", ""));
/** Plot coordinates are scaled integers; displayed values retain exact cents. */
export function SalesTrendChart({
  current,
  previous,
}: {
  current: SalesTrendPeriod;
  previous: SalesTrendPeriod;
}) {
  const gradient = useId();
  const [selected, setSelected] = useState(current.days.length - 1);
  const index = Math.min(selected, current.days.length - 1);
  const day = current.days[index],
    prior = previous.days[index];
  const maximum = [...current.days, ...previous.days].reduce(
    (max, row) => (cents(row.totalSales) > max ? cents(row.totalSales) : max),
    0n,
  );
  const proportion = (value: string) =>
    maximum === 0n ? 0 : Number((cents(value) * 10000n) / maximum) / 10000;
  const x = (i: number) =>
    current.days.length === 1
      ? 500
      : 20 + (i * 960) / (current.days.length - 1);
  const y = (value: string) => 210 - proportion(value) * 180;
  const points = (period: SalesTrendPeriod) =>
    period.days
      .map((row, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(row.totalSales)}`)
      .join(" ");
  return (
    <figure
      className="sales-trend-chart"
      aria-label="Gross sales comparison chart"
    >
      <figcaption className="sales-chart-legend">
        <span>
          <i />
          Selected period
        </span>
        <span>
          <i />
          Previous period
        </span>
        <small>Gross sales · PHP</small>
      </figcaption>
      {current.days.length === 1 ? (
        <div className="sales-single-comparison">
          {[
            { row: day, label: "Selected period" },
            { row: prior, label: "Previous period" },
          ].map(({ row, label }, i) => (
            <div className={i === 1 ? "is-previous" : ""} key={label}>
              <span>
                {label}
                <strong>{formatCartPrice(row.totalSales)}</strong>
              </span>
              <div className="sales-single-track" aria-hidden="true">
                <span
                  style={{ width: `${proportion(row.totalSales) * 100}%` }}
                />
              </div>
              <small>
                {row.businessDate} ·{" "}
                {row.completedOrders.toLocaleString("en-PH")} orders
              </small>
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="sales-chart-scale">
            <span>
              {formatCartPrice(
                (maximum / 100n).toString() +
                  "." +
                  String(maximum % 100n).padStart(2, "0"),
              )}
            </span>
            <span>Shared scale</span>
          </div>
          <svg
            className="sales-trend-plot"
            viewBox="0 0 1000 240"
            preserveAspectRatio="none"
            aria-hidden="true"
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width > 0)
                setSelected(
                  Math.max(
                    0,
                    Math.min(
                      current.days.length - 1,
                      Math.round(
                        ((((event.clientX - rect.left) / rect.width) * 1000 -
                          20) /
                          960) *
                          (current.days.length - 1),
                      ),
                    ),
                  ),
                );
            }}
          >
            <defs>
              <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity=".18" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[30, 90, 150, 210].map((position) => (
              <line
                key={position}
                className="sales-chart-gridline"
                x1="0"
                x2="1000"
                y1={position}
                y2={position}
              />
            ))}
            <path
              className="sales-chart-area"
              d={`${points(current)} L980,210 L20,210 Z`}
              fill={`url(#${gradient})`}
            />
            <path
              className="sales-chart-previous"
              d={points(previous)}
              vectorEffect="non-scaling-stroke"
            />
            <path
              className="sales-chart-current"
              d={points(current)}
              vectorEffect="non-scaling-stroke"
            />
            <line
              className="sales-chart-cursor"
              x1={x(index)}
              x2={x(index)}
              y1="20"
              y2="215"
            />
            <circle
              className="sales-chart-dot"
              cx={x(index)}
              cy={y(day.totalSales)}
              r="5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          <div className="sales-chart-dates">
            <span>{current.startDate}</span>
            <span>{current.endDate}</span>
          </div>
          <label className="sales-chart-inspector">
            Inspect comparison day{" "}
            <Input
              type="range"
              min="0"
              max={current.days.length - 1}
              value={index}
              aria-valuetext={`${day.businessDate}: ${formatCartPrice(day.totalSales)}; previous ${prior.businessDate}: ${formatCartPrice(prior.totalSales)}`}
              onChange={(event) => setSelected(Number(event.target.value))}
            />
          </label>
          <div className="sales-chart-readout" aria-live="polite">
            <span>
              {day.businessDate}
              <strong>{formatCartPrice(day.totalSales)}</strong>
              <small>
                {day.completedOrders.toLocaleString("en-PH")} orders
              </small>
            </span>
            <span>
              {prior.businessDate}
              <strong>{formatCartPrice(prior.totalSales)}</strong>
              <small>
                {prior.completedOrders.toLocaleString("en-PH")} orders ·
                previous
              </small>
            </span>
          </div>
        </>
      )}
    </figure>
  );
}
