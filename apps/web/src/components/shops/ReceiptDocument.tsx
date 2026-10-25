import type { ProductSelectionQuoteResponse, ReceiptPaymentDetails, ReceiptShopDetails as ShopDetails } from "@paserve/contracts";
import { FiCheckCircle, FiCoffee } from "react-icons/fi";
import { PiConfettiLight } from "react-icons/pi";
import { ReceiptShopDetails } from "./ReceiptShopDetails";
import { ReceiptOrderItems } from "../../pages/public/ReceiptOrderItems";
import { ReceiptPaymentMethod } from "../../pages/public/ReceiptPaymentMethod";
import { ReceiptTotals } from "../../pages/public/ReceiptTotals";
import { ReceiptTimestamps } from "../../pages/public/ReceiptTimestamps";
import "./receipt-document.css";
import "./receipt-document-print.css";

/** Saved receipt values shared by the customer copy and cashier print view. */
export function ReceiptDocument({ shopDetails, shopName, orderContext, orderNumber, items, totalPrice, subtotalPrice, payment, createdAt, paidAt, completedAt }: {
  shopDetails?: ShopDetails | null;
  shopName?: string;
  orderContext: string;
  orderNumber: string | null;
  items?: ProductSelectionQuoteResponse[];
  totalPrice: string;
  subtotalPrice?: string;
  payment?: ReceiptPaymentDetails | null;
  createdAt?: string;
  paidAt?: string | null;
  completedAt?: string | null;
}) {
  return (
    <section className="receipt-document" aria-label="Order receipt">
      <div className="receipt-ticket-paper">
        <div className="receipt-print-only receipt-print-masthead">
          <p>Customer copy / Paid receipt</p>
          <span className="receipt-paid-stamp"><FiCheckCircle aria-hidden="true" /> Payment received</span>
        </div>
        <header className="receipt-ticket-welcome">
          <span className="receipt-ticket-celebration" aria-hidden="true"><PiConfettiLight /></span>
          <h2>Thank you!</h2>
          <p>Your payment is confirmed.</p>
          <span className="receipt-paid-stamp"><FiCheckCircle aria-hidden="true" /> Paid</span>
        </header>
        <div className="receipt-ticket-perforation" aria-hidden="true" />
        <div className="receipt-document-reference">
          <div><span className="receipt-eyebrow">Order number</span><strong>{orderNumber ?? "Unavailable"}</strong></div>
          <p>{orderContext}<br /><span>Payment confirmed by the cashier.</span></p>
        </div>
        <div className="receipt-document-identity">
          <span className="receipt-print-only receipt-print-monogram" aria-hidden="true">
            {(shopDetails?.name ?? shopName ?? "Receipt").trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0]).join("").toLocaleUpperCase()}
          </span>
          {shopDetails ? <ReceiptShopDetails details={shopDetails} /> : <h2>{shopName ?? "Order receipt"}</h2>}
        </div>
        <div className="receipt-document-body">
          <section aria-label="Purchased items"><ReceiptOrderItems items={items} /></section>
          <div className="receipt-ticket-settlement" role="group" aria-label="Payment and totals">
            <ReceiptTotals receipt={{ totalPrice, subtotalPrice }} />
            <ReceiptPaymentMethod payment={payment} confirmed />
            <ReceiptTimestamps createdAt={createdAt} paidAt={paidAt} completedAt={completedAt} paid />
          </div>
        </div>
        <div className="receipt-document-signoff"><FiCoffee aria-hidden="true" /><p>Thank you for stopping by.<span>Made with care. Saved for you.</span></p></div>
      </div>
    </section>
  );
}
