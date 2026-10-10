import { PRODUCT_CURRENCY, PRODUCT_PRICE_PATTERN } from "@paserve/contracts";

const peso = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: PRODUCT_CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format exact decimal strings without converting monetary values to floats. */
export function formatProductPrice(value: string): string {
  if (!PRODUCT_PRICE_PATTERN.test(value)) return "—";
  const [whole, fraction = ""] = value.split(".");
  return peso
    .formatToParts(BigInt(whole))
    .map((part) =>
      part.type === "fraction" ? fraction.padEnd(2, "0") : part.value,
    )
    .join("");
}
