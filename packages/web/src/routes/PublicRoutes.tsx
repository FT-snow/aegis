import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { login } from "../lib/api";

type AuthMode = "login" | "signup";

export function LandingPage() {
  return (
    <main className="public-page landing-page">
      <header className="public-header">
        <Link className="public-brand" to="/" aria-label="Aegis home">
          AEGIS
        </Link>
        <nav className="public-nav" aria-label="Main navigation">
          <Link to="/app/overview">Open the dashboard</Link>
          <Link to="/arena">Watch the Survival Arena</Link>
          <Link className="public-nav-action" to="/login">
            Sign in
          </Link>
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <span aria-hidden="true" className="hero-rule" />
        <p className="eyebrow">A spending boundary for autonomous agents</p>
        <h1 id="landing-title">Give your agent a budget it can&apos;t break.</h1>
        <p className="landing-intro">
          Let agents act on your behalf while owner-defined rules decide what can move and what must
          wait.
        </p>
        <div className="landing-actions">
          <Link className="button button-primary" to="/app/overview">
            Open the dashboard
          </Link>
          <Link className="button button-secondary" to="/arena">
            Watch the Survival Arena
          </Link>
        </div>
      </section>

      <section className="policy-preview" aria-labelledby="policy-title">
        <div className="section-heading">
          <p className="eyebrow">Three checks before execution</p>
          <h2 id="policy-title">How a request is checked</h2>
        </div>
        <ul className="policy-outcomes">
          <li>
            <span>Inside policy</span>
            <span>Executes</span>
          </li>
          <li>
            <span>Outside policy</span>
            <span>Waits for the owner</span>
          </li>
          <li>
            <span>Key revoked</span>
            <span>Nothing moves</span>
          </li>
        </ul>
      </section>

      <section className="prd-pitch" aria-labelledby="prd-title">
        <p className="eyebrow">The Aegis premise</p>
        <h2 id="prd-title">
          AgentKit gives agents wallets. Aegis makes those wallets safe: policy enforced on-chain,
          with a human in the loop or without one.
        </h2>
        <p className="product-disclaimer">
          Product premise only. This frontend demo does not execute or verify blockchain
          transactions.
        </p>
      </section>

      <footer className="public-footer">
        <span>AEGIS</span>
        <span>Permissionless action. Enforced limits.</span>
      </footer>
    </main>
  );
}

export function LoginPage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [authError, setAuthError] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    const nextEmailError = !normalizedEmail
      ? "Enter your email address."
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        ? ""
        : "Enter a valid email address.";
    const nextPasswordError =
      password.length < 12 ? "Password must be at least 12 characters." : "";

    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setAuthError("");
    if (nextEmailError || nextPasswordError) {
      if (nextEmailError) emailRef.current?.focus();
      else passwordRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      await login(normalizedEmail, password, mode);
      onAuthenticated();
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/app/overview", { replace: true });
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setEmailError("");
    setPasswordError("");
    setAuthError("");
  }

  return (
    <main className="public-page auth-page">
      <header className="public-header">
        <Link className="public-brand" to="/" aria-label="Aegis home">
          AEGIS
        </Link>
        <Link className="auth-back-link" to="/">
          Back to home
        </Link>
      </header>

      <section className="auth-panel" aria-labelledby="auth-title">
        <p className="eyebrow">Owner access</p>
        <h1 id="auth-title">{mode === "login" ? "Welcome back." : "Create your account."}</h1>
        <p className="auth-intro">
          {mode === "login"
            ? "Sign in to manage your agent policies and approvals."
            : "Set up an account to start putting boundaries around agent spend."}
        </p>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <div className="form-field">
            <label htmlFor="auth-email">Email</label>
            <input
              autoComplete="email"
              aria-describedby="email-error"
              aria-invalid={Boolean(emailError)}
              id="auth-email"
              ref={emailRef}
              name="email"
              required
              onChange={(event) => {
                setEmail(event.target.value);
                setEmailError("");
                setAuthError("");
              }}
              type="email"
              value={email}
            />
            <p className="field-error" id="email-error" role="alert">
              {emailError}
            </p>
          </div>

          <div className="form-field">
            <label htmlFor="auth-password">Password</label>
            <div className="password-control">
              <input
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                aria-describedby="password-hint password-error"
                aria-invalid={Boolean(passwordError)}
                id="auth-password"
                ref={passwordRef}
                minLength={12}
                name="password"
                required
                onChange={(event) => {
                  setPassword(event.target.value);
                  setPasswordError("");
                  setAuthError("");
                }}
                type={showPassword ? "text" : "password"}
                value={password}
              />
              <button
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="password-visibility"
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <p className="field-hint" id="password-hint">
              Use at least 12 characters.
            </p>
            <p className="field-error" id="password-error" role="alert">
              {passwordError}
            </p>
          </div>

          <p className="auth-message" aria-live="polite" role="status">
            {authError}
          </p>
          <button
            className="button button-primary auth-submit"
            disabled={isSubmitting}
            type="submit"
          >
            {isSubmitting ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <p className="auth-mode-toggle">
          {mode === "login" ? "New to Aegis?" : "Already have an account?"}{" "}
          <button onClick={() => changeMode(mode === "login" ? "signup" : "login")} type="button">
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </main>
  );
}
