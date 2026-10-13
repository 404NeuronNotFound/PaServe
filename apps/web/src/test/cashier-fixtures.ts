import type { ProductSelectionQuoteResponse } from "@paserve/contracts";
export const cashierLine: ProductSelectionQuoteResponse = {
  productId: "saved-product",
  productName: "Saved Latte",
  currency: "PHP",
  quantity: 2,
  basePrice: "50.00",
  unitPrice: "67.75",
  totalPrice: "135.50",
  notes: "Less ice.\nNo lid.",
  variants: [
    {
      id: "saved-variant",
      name: "Large",
      optionGroupId: "saved-size",
      isDefault: false,
      priceAdjustment: "10.00",
    },
  ],
  addOns: [{ id: "saved-addon", name: "Oat milk", priceAdjustment: "7.75" }],
};
