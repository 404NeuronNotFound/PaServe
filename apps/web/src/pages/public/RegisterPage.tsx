import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FiCheckCircle } from "react-icons/fi";
import type { RegisterResponse } from "@paserve/contracts";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { RegistrationForm } from "../../features/auth/components/RegistrationForm";

export function RegisterPage() {
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = result
      ? "Registration received · PaServe"
      : "Create your account · PaServe";
    if (result) successHeading.current?.focus();
  }, [result]);

  return (
    <AuthLayout
      headingId="registration-heading"
      skipLabel="Skip to account creation"
    >
      {result ? (
        <div className="registration-success" role="status">
          <FiCheckCircle className="success-icon" aria-hidden="true" />
          <h1 ref={successHeading} tabIndex={-1} id="registration-heading">
            Registration received.
          </h1>
          <p>
            {result.message}
          </p>
          <p>
            <Link to="/login">Sign in to continue</Link>
          </p>
        </div>
      ) : (
        <>
          <p className="section-label">Welcome to PaServe</p>
          <h1 id="registration-heading">Create your account</h1>
          <p className="form-intro">
            Just your email and a password to get started.
          </p>
          <RegistrationForm
            onSuccess={(result) => {
              setResult(result);
            }}
          />
          <p className="account-note">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
          <p className="account-note">
            For owners and staff. Customers can order without an account.
          </p>
        </>
      )}
    </AuthLayout>
  );
}
