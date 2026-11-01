import { useEffect } from "react";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { PasswordRecoveryForm } from "../../features/auth/components/PasswordRecoveryForm";

export function ForgotPasswordPage() {
  useEffect(() => {
    document.title = "Reset your password · PaServe";
  }, []);
  return (
    <AuthLayout
      variant="login"
      headingId="recovery-heading"
      skipLabel="Skip to password recovery"
    >
      <p className="section-label">A fresh start</p>
      <h1 id="recovery-heading">Forgot your password?</h1>
      <p className="form-intro">
        Verify your email, then choose a new password.
      </p>
      <PasswordRecoveryForm />
      <p className="account-note">
        <a href="/login">Back to sign in</a>
      </p>
    </AuthLayout>
  );
}
