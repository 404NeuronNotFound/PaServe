import { useQueryClient } from "@tanstack/react-query";
import { signInDestination } from "../../features/auth/sign-in-destination";
import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { FiArrowRight, FiCheckCircle } from "react-icons/fi";
import type { RegisterResponse } from "@paserve/contracts";
import { AuthLayout } from "../../components/layout/AuthLayout";
import { RegistrationForm } from "../../features/auth/components/RegistrationForm";

export function RegisterPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
      variant="register"
      headingId="registration-heading"
      skipLabel="Skip to account creation"
    >
      {result ? (
        <div className="registration-complete auth-form-card" role="status">
          <span className="registration-complete-icon" aria-hidden="true">
            <FiCheckCircle />
          </span>
          <p className="section-label">Next: sign in</p>
          <h1 ref={successHeading} tabIndex={-1} id="registration-heading">
            Registration received.
          </h1>
          <p className="registration-complete-message">{result.message}</p>
          <div className="registration-complete-actions">
            <Button asChild variant="default" size="inherit">
              <Link to="/login">
                Sign in to continue <FiArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="section-label registration-welcome">Your next chapter starts here</p>
          <h1 id="registration-heading">Create your account</h1>
          <p className="form-intro registration-intro">Your people. Your place. Let’s get you started.</p>
          <RegistrationForm
            onGoogleSuccess={() => {
              queryClient.clear();
              void navigate(signInDestination(undefined), { replace: true });
            }}
            onSuccess={(result) => {
              setResult(result);
            }}
          />
        </>
      )}
    </AuthLayout>
  );
}
