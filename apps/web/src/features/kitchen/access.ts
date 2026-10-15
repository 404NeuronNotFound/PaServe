import { hasShopPermission, type ShopRole } from "@paserve/contracts";

export const canUseKitchen = (role: ShopRole) => hasShopPermission(role, "shop.preparation.queue.read");
