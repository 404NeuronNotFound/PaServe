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
  "%s requests and cache keys preserve search and cursor",
  async (view, request, key) => {
    const get = vi
      .spyOn(api, "get")
      .mockResolvedValue({ data: { orders: [], nextCursor: null } });
    try {
      const signal = new AbortController().signal;
      await request("shop-a", "cursor", signal, "Patio %_");
      expect(get).toHaveBeenCalledWith(
        `/shops/shop-a/orders/${view}`,
        expect.objectContaining({
          params: { cursor: "cursor", search: "Patio %_" },
          signal,
        }),
      );
      expect(key("user-a", "shop-a", null, "Patio")).not.toEqual(
        key("user-a", "shop-a", null, "ORD"),
      );
      expect(key("user-a", "shop-a", null, "Patio")).not.toEqual(
        key("user-b", "shop-a", null, "Patio"),
      );
      expect(key("user-a", "shop-a", null, "Patio")).not.toEqual(
        key("user-a", "shop-b", null, "Patio"),
      );
    } finally {
      get.mockRestore();
    }
  },
);
