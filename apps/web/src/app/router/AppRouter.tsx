import { useEffect, useState } from "react";
import { NavigationProtection } from "./NavigationProtection";
import {
  createBrowserRouter,
  createRoutesFromElements,
  RouterProvider,
  Navigate,
  Outlet,
  Route,
} from "react-router-dom";
import { RegisterPage } from "../../pages/public/RegisterPage";
import { PublicMenuPage } from "../../pages/public/PublicMenuPage";
import { CustomerOrderPage } from "../../pages/public/CustomerOrderPage";
import { CustomerReceiptPage } from "../../pages/public/CustomerReceiptPage";
import { ConnectionPage } from "../../pages/public/ConnectionPage";
import { LoginPage } from "../../pages/public/LoginPage";
import { AccountPage } from "../../pages/owner/AccountPage";
import { NotificationsPage } from "../../pages/owner/NotificationsPage";
import { ProfilePage } from "../../pages/owner/ProfilePage";
import { PlacesPage } from "../../pages/owner/PlacesPage";
import { CreateShopPage } from "../../pages/owner/CreateShopPage";
import { ProtectedRoute } from "../../features/auth/components/ProtectedRoute";
import { AuthEntryRoute } from "../../features/auth/components/AuthEntryRoute";
import { ActiveShopRoute } from "../../features/shops/ActiveShopRoute";
import {
  ResolveActiveShop,
  ShopSelectionPage,
} from "../../pages/owner/ShopSelectionPage";
import { ActiveShopPage } from "../../pages/owner/ActiveShopPage";
import { SalesDashboardPage } from "../../pages/owner/SalesDashboardPage";
import { ActiveOrdersPage } from "../../pages/owner/ActiveOrdersPage";
import { CompletedOrdersPage } from "../../pages/owner/CompletedOrdersPage";
import { CancelledOrdersPage } from "../../pages/owner/CancelledOrdersPage";
import { OrdersLayout } from "../../pages/owner/OrdersLayout";
import { OrderDetailsPage } from "../../pages/owner/OrderDetailsPage";
import { ShopSettingsPage } from "../../pages/owner/ShopSettingsPage";
import { CategoriesPage } from "../../pages/owner/CategoriesPage";
import { TablesPage } from "../../pages/owner/TablesPage";
import { ProductsPage } from "../../pages/owner/ProductsPage";
import { AddOnsPage } from "../../pages/owner/AddOnsPage";
import { ProductCustomizationPage } from "../../pages/owner/ProductCustomizationPage";
import { MenuPreviewPage } from "../../pages/owner/MenuPreviewPage";
import { OwnerDashboardLayout } from "../../components/layout/OwnerDashboardLayout";
import { CashierRoute } from "../../features/cashier/CashierRoute";
import { CashierPage } from "../../pages/cashier/CashierPage";
import { StaffPage } from "../../pages/owner/StaffPage";
import { JoinShopPage } from "../../pages/public/JoinShopPage";
import { KitchenRoute } from "../../features/kitchen/KitchenRoute";
import { KitchenPage } from "../../pages/kitchen/KitchenPage";
import { NotFoundPage } from "../../pages/public/NotFoundPage";

let sharedRouter: ReturnType<typeof createBrowserRouter> | undefined;
let routerConsumers = 0;

export function AppRouter() {
  const [router] = useState(() => sharedRouter ??= createBrowserRouter(createRoutesFromElements(
      <Route element={<NavigationProtection><Outlet /></NavigationProtection>}>
        <Route path="/:shopSlug/table/:tableCode" element={<PublicMenuPage />} />
        <Route path="/menu/:shopSlug" element={<PublicMenuPage />} />
        <Route
          path="/menu/:shopSlug/orders/:orderId/receipt"
          element={<CustomerReceiptPage />}
        />
        <Route
          path="/menu/:shopSlug/orders/:orderId"
          element={<CustomerOrderPage />}
        />
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/register" element={<AuthEntryRoute><RegisterPage /></AuthEntryRoute>} />
        <Route path="/login" element={<AuthEntryRoute><LoginPage /></AuthEntryRoute>} />
        <Route path="/join/:shopId" element={<JoinShopPage />} />
        <Route
          path="/app"
          element={
            <ProtectedRoute>
              <Outlet />
            </ProtectedRoute>
          }
        >
          <Route index element={<ResolveActiveShop />} />
          <Route path="shops" element={<ShopSelectionPage />} />
          <Route path="shops/:shopId" element={<ActiveShopRoute />}>
            <Route element={<OwnerDashboardLayout />}>
              <Route index element={<ActiveShopPage />} />
              <Route path="sales" element={<SalesDashboardPage />} />
              <Route path="orders" element={<OrdersLayout />}>
                <Route index element={<ActiveOrdersPage />} />
                <Route path="completed" element={<CompletedOrdersPage />} />
                <Route path="cancelled" element={<CancelledOrdersPage />} />
                <Route path=":orderId" element={<OrderDetailsPage />} />
              </Route>
              <Route path="cashier" element={<CashierRoute />}>
                <Route index element={<CashierPage />} />
              </Route>
              <Route path="kitchen" element={<KitchenRoute />}>
                <Route index element={<KitchenPage />} />
              </Route>
              <Route path="settings" element={<ShopSettingsPage />} />
              <Route path="staff" element={<StaffPage />} />
              <Route path="categories" element={<CategoriesPage />} />
              <Route path="tables" element={<TablesPage />} />
              <Route path="products" element={<ProductsPage />} />
              <Route path="products/:productId/customize" element={<ProductCustomizationPage />} />
              <Route path="add-ons" element={<AddOnsPage />} />
              <Route path="menu-preview" element={<MenuPreviewPage />} />
            </Route>
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route path="account/notifications" element={<NotificationsPage />} />
          <Route path="account/profile" element={<ProfilePage />} />
          <Route path="account/places" element={<PlacesPage />} />
          <Route path="onboarding/create-shop" element={<CreateShopPage />} />
        </Route>
        <Route path="/connection" element={<ConnectionPage />} />
        {["api", "admin", "shops", "menu"].map((path) => (
          <Route key={path} path={`/${path}`} element={<NotFoundPage />} />
        ))}
        <Route path="/:shopSlug" element={<PublicMenuPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
  )));
  useEffect(() => {
    routerConsumers++;
    return () => {
      routerConsumers--;
      // StrictMode immediately remounts effects; defer disposal until it settles.
      queueMicrotask(() => {
        if (!routerConsumers && sharedRouter === router) {
          router.dispose();
          sharedRouter = undefined;
        }
      });
    };
  }, [router]);
  return <RouterProvider router={router} />;
}
