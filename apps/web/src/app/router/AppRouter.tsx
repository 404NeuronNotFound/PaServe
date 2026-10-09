import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { RegisterPage } from "../../pages/public/RegisterPage";
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

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
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
            <Route index element={<ActiveShopPage />} />
          </Route>
          <Route path="account" element={<AccountPage />} />
          <Route path="onboarding/create-shop" element={<CreateShopPage />} />
        </Route>
        <Route path="/connection" element={<ConnectionPage />} />
        <Route
          path="*"
          element={
            <main className="connection-page">
              <h1>Page not found</h1>
              <a href="/register">Go to registration</a>
            </main>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
