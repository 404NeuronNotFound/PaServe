import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { RegisterPage } from "../../pages/public/RegisterPage";
import { PublicMenuPage } from "../../pages/public/PublicMenuPage";
import { CustomerOrderPage } from "../../pages/public/CustomerOrderPage";
import { CustomerReceiptPage } from "../../pages/public/CustomerReceiptPage";
import { ConnectionPage } from "../../pages/public/ConnectionPage";
import { LoginPage } from "../../pages/public/LoginPage";
import { AccountPage } from "../../pages/owner/AccountPage";
import { CreateShopPage } from "../../pages/owner/CreateShopPage";
import { ProtectedRoute } from "../../features/auth/components/ProtectedRoute";
import { ActiveShopRoute } from "../../features/shops/ActiveShopRoute";
import {
  ResolveActiveShop,
  ShopSelectionPage,
} from "../../pages/owner/ShopSelectionPage";
import { ActiveShopPage } from "../../pages/owner/ActiveShopPage";
import { ActiveOrdersPage } from "../../pages/owner/ActiveOrdersPage";
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

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
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
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
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
              <Route path="orders" element={<ActiveOrdersPage />} />
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
          <Route path="onboarding/create-shop" element={<CreateShopPage />} />
        </Route>
        <Route path="/connection" element={<ConnectionPage />} />
        {["api", "admin", "shops", "menu"].map((path) => (
          <Route key={path} path={`/${path}`} element={<PageNotFound />} />
        ))}
        <Route path="/:shopSlug" element={<PublicMenuPage />} />
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

function PageNotFound() {
  return (
    <main className="connection-page">
      <h1>Page not found</h1>
      <a href="/register">Go to registration</a>
    </main>
  );
}
