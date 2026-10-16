import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isValidOrderNumber } from "@paserve/contracts";
import { FiArrowUpRight, FiCheck, FiShoppingBag } from "react-icons/fi";
import { useActiveShop } from "../../features/shops/active-shop";
import { OrderQrScanner } from "./OrderQrScanner";
import { useNewOrderEvents } from "../../features/orders/useNewOrderEvents";
import { InlineMessage } from "../../components/feedback/InlineMessage";

export function CashierPage() {
  const [params] = useSearchParams();
  const requestedNumber = params.get("orderNumber");
  const initialOrderNumber = isValidOrderNumber(requestedNumber) ? requestedNumber : "";
  const membership = useActiveShop();
  const [arrivalShop, setArrivalShop] = useState<string | null>(null);
  const liveStatus = useNewOrderEvents(
    membership.shopId,
    "cashier",
    (isNewOrder) => {
      if (isNewOrder) setArrivalShop(membership.shopId);
    },
  );
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `Cashier · ${membership.shop.name} · PaServe`;
    heading.current?.focus();
  }, [membership.shop.name]);
  return (
    <section className="shop-context-content cashier-workspace">
      <header className="cashier-workspace-header">
        <div>
          <p className="section-label">FRONT COUNTER / CASHIER</p>
          <h1 ref={heading} tabIndex={-1}>
            Cashier workspace
          </h1>
          <p className="cashier-workspace-intro">
            Scan, review and confirm customer orders.
          </p>
        </div>
        <div
          className="cashier-shop-context"
          role="group"
          aria-label={`Active shop: ${membership.shop.name}. Role: ${membership.role.toLowerCase()}.`}
        >
          <span className="cashier-shop-icon">
            <FiShoppingBag aria-hidden="true" />
          </span>
          <div>
            <strong>{membership.shop.name}</strong>
            <span>
              {membership.role.toLowerCase()} <span aria-hidden="true">·</span>{" "}
              <FiCheck aria-hidden="true" /> Access verified
            </span>
          </div>
          <Link className="secondary-button cashier-switch" to="/app/shops">
            Switch shop <FiArrowUpRight aria-hidden="true" />
          </Link>
        </div>
      </header>
      <ol className="cashier-flow" aria-label="Cashier workflow">
        <li>
          <span>01</span> Find an order
        </li>
        <li>
          <span>02</span> Review the details
        </li>
        <li>
          <span>03</span> Confirm or reject
        </li>
      </ol>
      <OrderQrScanner key={`${membership.shopId}:${initialOrderNumber}`} shopId={membership.shopId} initialOrderNumber={initialOrderNumber} />
      {(liveStatus === "delayed" || liveStatus === "denied") && (
        <InlineMessage tone="warning" className="">
          {liveStatus === "denied"
            ? "Order access is unavailable. Choose a shop with active cashier access."
            : "Order updates are delayed. Scan an order QR or enter its number to check."}
        </InlineMessage>
      )}
      {liveStatus !== "denied" && arrivalShop === membership.shopId && (
        <InlineMessage tone="info" className="">
          A new order arrived. Scan the customer's QR or enter their order
          number to review it.
        </InlineMessage>
      )}
    </section>
  );
}
