import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import {
  SHOP_PERMISSIONS,
  SHOP_ROLES,
  hasShopPermission,
  type ShopPermission,
} from "@paserve/contracts";

const labels: Record<ShopPermission, string> = {
  "shop.menu.manage": "Manage menu and prices",
  "shop.orders.manage": "Daily order operations",
  "shop.reports.read": "Read operational reports",
  "shop.daily-operations.manage": "Manage daily operations",
  "shop.orders.qr.scan": "Scan order QR codes",
  "shop.orders.read": "Read counter orders",
  "shop.payments.record": "Record payments",
  "shop.orders.confirm": "Confirm orders",
  "shop.orders.reject": "Reject orders",
  "shop.menu.availability.update": "Update item availability",
  "shop.preparation.queue.read": "View preparation queue",
  "shop.preparation.status.update": "Update preparation status",
  "shop.operations.manage": "Shop administration and tables",
  "shop.settings.manage": "Manage shop settings",
  "shop.ownership.manage": "Ownership (reserved)",
  "shop.billing.manage": "Billing (reserved)",
  "shop.staff.manage": "Manage staff and invitations",
  "shop.orders.overview.read": "Owner order views and history",
};

export function PermissionMatrix() {
  return (
    <details className="staff-panel staff-permissions">
      <summary>Permissions by role</summary>
      <p>
        Roles use fixed permissions. Disabled memberships have no shop access.
        Ownership and billing are reserved policies; this page does not provide
        those actions.
      </p>
      <Table containerClassName="staff-permissions-scroll" scrollLabel="Role permission matrix">
          <TableCaption>Shop permissions by role</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Capability</TableHead>
              {SHOP_ROLES.map((role) => (
                <TableHead scope="col" key={role}>
                  {role === "KITCHEN"
                    ? "Kitchen / Barista"
                    : role[0] + role.slice(1).toLowerCase()}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {SHOP_PERMISSIONS.map((permission) => (
              <TableRow key={permission}>
                <TableHead scope="row">{labels[permission]}</TableHead>
                {SHOP_ROLES.map((role) => (
                  <TableCell key={role}>
                    {hasShopPermission(role, permission) ? "Allowed" : "Denied"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
    </details>
  );
}
