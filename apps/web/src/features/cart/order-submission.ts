import type { CreateCustomerOrderRequest } from "@paserve/contracts";

/** Only identifiers and customer input cross the order-submission boundary. */
export function orderSubmissionRequest(
  request: CreateCustomerOrderRequest,
): CreateCustomerOrderRequest {
  const items = request.items.map((item) => ({
    productId: item.productId,
    variantIds: [...item.variantIds],
    addOnIds: [...item.addOnIds],
    quantity: item.quantity,
    ...(item.notes !== undefined ? { notes: item.notes } : {}),
  }));
  return request.mode === "TAKEOUT"
    ? { requestId: request.requestId, mode: "TAKEOUT", items }
    : {
        requestId: request.requestId,
        mode: "DINE_IN",
        tableCode: request.tableCode,
        tableToken: request.tableToken,
        items,
      };
}
