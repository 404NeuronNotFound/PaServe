import { hasShopPermission, type ShopRole } from "@paserve/contracts";

export function canUseCashier(role: ShopRole): boolean {
  return (
    hasShopPermission(role, "shop.orders.qr.scan") &&
    hasShopPermission(role, "shop.payments.record")
  );
}
