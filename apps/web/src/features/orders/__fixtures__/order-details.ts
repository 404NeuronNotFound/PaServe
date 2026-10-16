import type { OwnerOrderDetailsResponse } from "@paserve/contracts";

export const orderDetailsFixture = (): OwnerOrderDetailsResponse => ({
  order: {
    id: "order-a",
    shopId: "shop-a",
    orderNumber: "ORD-000042",
    mode: "DINE_IN",
    tableNumber: "Patio 2",
    status: "CONFIRMED",
    paymentStatus: "PAID",
    preparationStatus: "COMPLETED",
    currency: "PHP",
    totalPrice: "36.00",
    shopDetails: null,
    snapshotIssue: null,
    rejectionReason: null,
    items: [
      {
        productId: "coffee",
        productName: "Original coffee",
        currency: "PHP",
        quantity: 2,
        basePrice: "10.00",
        unitPrice: "18.00",
        totalPrice: "36.00",
        notes: "Less ice",
        variants: [
          {
            id: "large",
            name: "Large",
            optionGroupId: "size",
            isDefault: false,
            priceAdjustment: "5.00",
          },
        ],
        addOns: [{ id: "milk", name: "Oat milk", priceAdjustment: "3.00" }],
      },
    ],
    payment: {
      method: "CASH",
      reference: null,
      description: null,
      amountReceived: "50.00",
      changeDue: "14.00",
    },
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:05:00.000Z",
    paidAt: "2026-10-16T00:01:00.000Z",
    completedAt: "2026-10-16T00:05:00.000Z",
    history: [
      { status: "PLACED", at: "2026-10-16T00:00:00.000Z", actorId: null },
      { status: "PAID", at: "2026-10-16T00:01:00.000Z", actorId: "owner-a" },
      {
        status: "COMPLETED",
        at: "2026-10-16T00:05:00.000Z",
        actorId: "owner-a",
      },
    ],
    permittedActions: ["RECEIPT"],
  },
});
