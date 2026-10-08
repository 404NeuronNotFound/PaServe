import { useState } from "react";
import type { RegisteredUser } from "@paserve/contracts";
import { RegistrationForm } from "../../features/auth/components/RegistrationForm";

export function RegisterPage() {
  const [user, setUser] = useState<RegisteredUser | null>(null);
  return (
    <main className="auth-page">
      <aside className="brand-panel" aria-label="About PaServe">
        <a className="wordmark" href="/" aria-label="PaServe home">
          <span className="brand-symbol" aria-hidden="true">
            p.
          </span>
          PaServe
        </a>
        <div className="brand-story">
          <p className="eyebrow">A LITTLE LESS BUSYWORK.</p>
          <h1>
            More time{" "}
            <br />
            for the good{" "}
            <br />
            <em>you serve.</em>
          </h1>
          <p className="brand-description">
            A simpler way to run your café, coffee shop, or restaurant. It
            starts with your account.
          </p>
        </div>
        <div className="brand-footer">
          <span className="small-star" aria-hidden="true">
            ✳
          </span>
          <span>Made for the people behind the counter.</span>
        </div>
        <div className="brand-rings" aria-hidden="true" />
      </aside>
      <section className="form-panel" aria-labelledby="registration-heading">
        <div className="form-content">
          <p className="eyebrow">WELCOME TO PASERVE</p>
          {user ? (
            <div className="registration-success" role="status">
              <div className="success-mark" aria-hidden="true">
                ✓
              </div>
              <h2 id="registration-heading">You’re registered.</h2>
              <p>
                Your account has been created for <strong>{user.email}</strong>.
              </p>
              <p>Welcome to PaServe.</p>
            </div>
          ) : (
            <>
              <h2 id="registration-heading">Create your account.</h2>
              <p className="form-intro">Your next chapter starts here.</p>
              <RegistrationForm onSuccess={(result) => setUser(result.user)} />
              <p className="account-note">
                Setting up a shop? Start with your account.
                <br />
                Ordering as a customer? No account needed.
              </p>
            </>
          )}
        </div>
        <footer className="form-footer">
          PaServe <span aria-hidden="true">·</span> A smoother day, from the
          first order.
        </footer>
      </section>
    </main>
  );
}
