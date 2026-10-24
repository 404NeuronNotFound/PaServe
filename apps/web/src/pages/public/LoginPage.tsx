import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { LoginForm } from "../../features/auth/components/LoginForm";
import { feedback } from "../../app/stores/feedback";
import { signInDestination } from "../../features/auth/sign-in-destination";

export function LoginPage() {
  useEffect(() => {
    document.title = "Sign in · PaServe";
  }, []);
  const navigate = useNavigate();
  const location = useLocation();
  const requestedPath: unknown = location.state?.returnTo;
  // Only resume a known cashier route; never accept arbitrary redirect URLs.
  const returnTo = signInDestination(requestedPath);
  const queryClient = useQueryClient();
  return (
    <AuthLayout headingId="login-heading">
      <p className="section-label">Welcome back</p>
      <h1 id="login-heading">Sign in to PaServe</h1>
      <p className="form-intro">Use your email and password to continue.</p>
      <LoginForm
        onSuccess={() => {
          feedback.clearTransient();
          feedback.toast("You are signed in.");
          queryClient.clear();
          // The destination verifies a fresh session and shop membership.
          void navigate(returnTo, { replace: true });
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
