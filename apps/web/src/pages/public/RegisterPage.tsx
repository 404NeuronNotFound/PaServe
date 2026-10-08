import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FiCheckCircle, FiCoffee } from "react-icons/fi";
import type { RegisteredUser } from "@paserve/contracts";
import { RegistrationForm } from "../../features/auth/components/RegistrationForm";

export function RegisterPage() {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (user) successHeading.current?.focus();
  }, [user]);

  return (
    <>
      <a className="skip-link" href="#registration-content">
        Skip to account creation
      </a>
      <main className="auth-page">
        <aside className="welcome-panel" aria-label="About PaServe">
          <Link className="wordmark" to="/" aria-label="PaServe home">
            <FiCoffee className="brand-icon" aria-hidden="true" />
            <span>PaServe</span>
          </Link>
          <div className="welcome-content">
            <p className="section-label">For your shop</p>
            <h2>
              Less admin. <br />
              More service.
            </h2>
            <p className="welcome-description">
              A simpler way to run your cafe, coffee shop, or restaurant.
            </p>
          </div>
        </aside>

        <section
          id="registration-content"
          tabIndex={-1}
          className="form-panel"
          aria-labelledby="registration-heading"
        >
          <div className="form-content">
            {user ? (
              <div className="registration-success" role="status">
                <FiCheckCircle className="success-icon" aria-hidden="true" />
                <h1
                  ref={successHeading}
                  tabIndex={-1}
                  id="registration-heading"
                >
                  Account created.
                </h1>
                <p>
                  Your PaServe account is ready for{" "}
                  <strong>{user.email}</strong>.
                </p>
                <p>Welcome aboard.</p>
              </div>
            ) : (
              <>
                <p className="section-label">Welcome to PaServe</p>
                <h1 id="registration-heading">Create your account</h1>
                <p className="form-intro">
                  Just your email and a password to get started.
                </p>
                <RegistrationForm
                  onSuccess={(result) => setUser(result.user)}
                />
                <p className="account-note">
                  For owners and staff. Customers can order without an account.
                </p>
              </>
            )}
          </div>
          <footer className="form-footer">Simple tools. Better service.</footer>
        </section>
      </main>
    </>
  );
}
