import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { RegisterPage } from "../../pages/public/RegisterPage";
import { ConnectionPage } from "../../pages/public/ConnectionPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/register" element={<RegisterPage />} />
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
