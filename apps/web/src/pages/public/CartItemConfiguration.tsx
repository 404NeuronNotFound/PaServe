import type { CartItem } from "../../features/cart/cart";
import { formatCartPrice } from "../../lib/money";
import "./cart-item-configuration.css";

/** Display saved quote snapshots; do not recalculate or submit client prices. */
export function CartItemConfiguration({ item, groupClassName }: {
  item: CartItem;
  groupClassName?: string;
}) {
  return (
    <div className="cart-item-configuration">
      {!!item.variants.length && <p className={groupClassName}>Variants: {item.variants.map((option) => option.name).join(", ")}</p>}
      {!!item.addOns.length && <p className={groupClassName}>Add-ons: {item.addOns.map((option) => option.name).join(", ")}</p>}
      <details className="cart-item-price-details">
        <summary>Price breakdown<span className="sr-only"> for {item.productName}</span></summary>
        <p className="cart-item-price-hint">Per item; selected extras are included in the unit price.</p>
        <dl>
          <div><dt>Base price</dt><dd>{formatCartPrice(item.basePrice)}</dd></div>
          {item.variants.map((option) => <div key={`variant-${option.id}`}>
            <dt>{option.name} <span>(variant)</span></dt>
            <dd>{Number(option.priceAdjustment) === 0 ? "Included" : `+${formatCartPrice(option.priceAdjustment)}`}</dd>
          </div>)}
          {item.addOns.map((option) => <div key={`addon-${option.id}`}>
            <dt>{option.name} <span>(add-on)</span></dt>
            <dd>{Number(option.priceAdjustment) === 0 ? "Free" : `+${formatCartPrice(option.priceAdjustment)}`}</dd>
          </div>)}
          <div className="cart-item-unit-total"><dt>Configured unit price</dt><dd>{formatCartPrice(item.unitPrice)}</dd></div>
        </dl>
      </details>
    </div>
  );
}
