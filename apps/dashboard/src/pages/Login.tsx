import { useState, type FormEvent } from "react";
import { apiRequest, errorMessage, rememberCsrfToken } from "../api";
import { Alert } from "../ui";
import { Link } from "../router";
import { useAppData } from "../appdata";
import type { User } from "../types";

export function Login() {
  const { signIn } = useAppData();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (mode === "register") {
        await apiRequest<{ user: User }>("/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        setMode("login");
        setPassword("");
        setMessage("Account created. Sign in to start a session.");
      } else {
        const response = await apiRequest<{ user: User; csrfToken?: string; expiresAt?: number }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        if (response.csrfToken) rememberCsrfToken(response.csrfToken);
        signIn(response.user, response.csrfToken);
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card reveal" style={{ ["--index" as string]: 0 }}>
        <p className="eyebrow"><Link to="/" className="text-button">AEGIS</Link></p>
        <h1>{mode === "login" ? "Sign in" : "Create an account"}</h1>
        <p className="muted">Use an account configured on the Aegis API.</p>
        {message && <Alert kind="success">{message}</Alert>}
        {error && <Alert>{error}</Alert>}
        <form className="form-stack" onSubmit={submit}>
          <label>
            Email
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={mode === "register" ? 12 : 1}
              required
            />
            {mode === "register" && <span className="field-help">At least 12 characters.</span>}
          </label>
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Register"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "Need an account?" : "Already registered?"}{" "}
          <button className="text-button" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setMessage(""); }}>
            {mode === "login" ? "Register" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
