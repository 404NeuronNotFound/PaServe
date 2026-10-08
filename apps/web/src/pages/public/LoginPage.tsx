import { Link, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { LoginForm } from "../../features/auth/components/LoginForm";
import { currentUserKey } from "../../features/auth/api/session";

export function LoginPage() {
  useEffect(() => {
    document.title = "Sign in · PaServe";
  }, []);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return (
    <AuthLayout headingId="login-heading">
      <p className="section-label">Welcome back</p>
      <h1 id="login-heading">Sign in to PaServe</h1>
      <p className="form-intro">Use your email and password to continue.</p>
      <LoginForm
        onSuccess={(session) => {
          queryClient.clear();
          queryClient.setQueryData(currentUserKey, { user: session.user });
          void navigate("/app/account", { replace: true });
        }}
      />
      <p className="account-note">
        New to PaServe? <Link to="/register">Create an account</Link>
      </p>
      <p className="account-note">
        For owners and staff. Customers can order without an account.
      </p>
    </AuthLayout>
  );
}
