import { hasShopPermission, type ShopPermission, type ShopRole } from "@paserve/contracts";
import type { IconType } from "react-icons";
import {
  FiClipboard, FiCoffee, FiCreditCard, FiEye, FiGrid, FiLayers,
  FiLayout, FiPackage, FiSettings, FiSliders, FiTrendingUp, FiUsers,
} from "react-icons/fi";

export type WorkspaceDestination = {
  path: string;
  label: string;
  icon: IconType;
  permissions: readonly ShopPermission[];
};

export const workspaceGroups: readonly {
  id: string;
  label: string;
  name: string;
  permission?: ShopPermission;
  items: readonly WorkspaceDestination[];
}[] = [
  {
    id: "daily", label: "Daily workspace", name: "Workspace",
    items: [
      { path: "", label: "Overview", icon: FiGrid, permissions: [] },
      { path: "sales", label: "Sales dashboard", icon: FiTrendingUp, permissions: ["shop.reports.read"] },
      { path: "orders", label: "Orders", icon: FiClipboard, permissions: ["shop.orders.overview.read"] },
      { path: "cashier", label: "Cashier", icon: FiCreditCard, permissions: ["shop.orders.qr.scan", "shop.payments.record"] },
      { path: "kitchen", label: "Kitchen / Barista", icon: FiCoffee, permissions: ["shop.preparation.queue.read"] },
    ],
  },
  {
    id: "menu", label: "Menu & catalog", name: "Menu management", permission: "shop.menu.manage",
    items: [
      { path: "products", label: "Products", icon: FiPackage, permissions: ["shop.menu.manage"] },
      { path: "categories", label: "Categories", icon: FiLayers, permissions: ["shop.menu.manage"] },
      { path: "add-ons", label: "Add-ons", icon: FiSliders, permissions: ["shop.menu.manage"] },
      { path: "menu-preview", label: "Menu preview", icon: FiEye, permissions: ["shop.settings.manage"] },
    ],
  },
  {
    id: "management", label: "Shop management", name: "Restaurant management", permission: "shop.operations.manage",
    items: [
      { path: "tables", label: "Tables", icon: FiLayout, permissions: ["shop.operations.manage"] },
      { path: "staff", label: "Staff & invitations", icon: FiUsers, permissions: ["shop.staff.manage"] },
      { path: "settings", label: "Shop settings", icon: FiSettings, permissions: ["shop.settings.manage"] },
    ],
  },
];

/** Use only with a live validated shop membership; APIs remain authoritative. */
export function navigationForRole(role: ShopRole) {
  return workspaceGroups
    .filter((group) => !group.permission || hasShopPermission(role, group.permission))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.permissions.every((permission) => hasShopPermission(role, permission))),
    }))
    .filter((group) => group.items.length);
}
