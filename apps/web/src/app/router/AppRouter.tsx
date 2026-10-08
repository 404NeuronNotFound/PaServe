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
import { ProtectedRoute } from "../../features/auth/components/ProtectedRoute";

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
          <Route index element={<Navigate to="account" replace />} />
          <Route path="account" element={<AccountPage />} />
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
