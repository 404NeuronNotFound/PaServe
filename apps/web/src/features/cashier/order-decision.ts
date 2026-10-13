import type {
  OrderDecisionResponse,
  VerifyOrderQrResponse,
} from "@paserve/contracts";
import { api, AUTH_REQUEST_TIMEOUT_MS } from "../../lib/api/client";

export async function decideOrder(
  order: VerifyOrderQrResponse["order"],
  qrToken: string,
  action: "confirm" | "reject",
  rejectionReason: string,
  signal: AbortSignal,
) {
  const { data } = await api.post<OrderDecisionResponse>(
    `/shops/${encodeURIComponent(order.shopId)}/orders/${encodeURIComponent(order.id)}/${action}${qrToken ? "" : "-number"}`,
    {
      ...(qrToken ? { qrToken } : { orderNumber: order.orderNumber }),
      reviewVersion: order.reviewVersion,
      ...(action === "reject" && rejectionReason.trim()
        ? { rejectionReason: rejectionReason.trim() }
        : {}),
    },
    { signal, timeout: AUTH_REQUEST_TIMEOUT_MS },
  );
  const saved = data?.order;
  if (
    !saved ||
    saved.id !== order.id ||
    saved.shopId !== order.shopId ||
    saved.orderNumber !== order.orderNumber ||
    saved.status !== (action === "confirm" ? "CONFIRMED" : "REJECTED") ||
    saved.paymentStatus !== "UNPAID" ||
    typeof saved.decidedBy !== "string" ||
    !saved.decidedBy ||
    typeof saved.decidedAt !== "string" ||
    !Number.isFinite(Date.parse(saved.decidedAt)) ||
    !(
      saved.rejectionReason === null ||
      typeof saved.rejectionReason === "string"
    )
  )
    throw new Error("The decision response could not be verified.");
  return saved;
}
