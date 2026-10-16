import { expect, it, vi } from "vitest";
import { api } from "../../lib/api/client";
import { activeOrdersKey, getActiveOrders } from "./active-orders";
import { completedOrdersKey, getCompletedOrders } from "./completed-orders";
import { cancelledOrdersKey, getCancelledOrders } from "./cancelled-orders";

it.each([
  ["active", getActiveOrders, activeOrdersKey],
  ["completed", getCompletedOrders, completedOrdersKey],
  ["cancelled", getCancelledOrders, cancelledOrdersKey],
] as const)(
  "%s combines safe filter parameters with search/cursor and isolates cache entries",
  async (view, request, key) => {
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: { orders: [], nextCursor: null } });
    try {
      const signal = new AbortController().signal;
      const filters = {
        mode: "DINE_IN" as const,
        table: "Patio %_",
        from: "2026-10-16",
        to: "2026-10-16",
      };
      await request("shop-a", "cursor", signal, "ORD", filters);
      expect(get).toHaveBeenCalledWith(
        `/shops/shop-a/orders/${view}`,
        expect.objectContaining({
          params: { cursor: "cursor", search: "ORD", ...filters },
          signal,
        }),
      );
      expect(key("owner", "shop-a", null, "ORD", filters)).not.toEqual(
        key("owner", "shop-a", null, "ORD", {}),
      );
      expect(key("owner", "shop-a", null, "ORD", filters)).not.toEqual(
        key("owner", "shop-b", null, "ORD", filters),
      );
    } finally {
      get.mockRestore();
    }
  },
);
