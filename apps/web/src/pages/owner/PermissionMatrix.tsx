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
      <div
        className="staff-permissions-scroll"
        role="region"
        aria-label="Role permission matrix"
        tabIndex={0}
      >
        <table>
          <caption>Shop permissions by role</caption>
          <thead>
            <tr>
              <th scope="col">Capability</th>
              {SHOP_ROLES.map((role) => (
                <th scope="col" key={role}>
                  {role === "KITCHEN"
                    ? "Kitchen / Barista"
                    : role[0] + role.slice(1).toLowerCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SHOP_PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <th scope="row">{labels[permission]}</th>
                {SHOP_ROLES.map((role) => (
                  <td key={role}>
                    {hasShopPermission(role, permission) ? "Allowed" : "Denied"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
