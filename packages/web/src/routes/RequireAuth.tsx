import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function safeNextPath(candidate: string | null, fallback = "/app"): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/app")) return fallback;
  if (candidate.startsWith("//") || candidate.includes("/../")) return fallback;
  return candidate;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  const next = `${location.pathname}${location.search}`;

  if (status === "loading") {
    return (
      <div aria-busy="true" aria-live="polite" className="loading-state" role="status">
        <p className="eyebrow">Checking your session...</p>
      </div>
    );
  }
  if (status === "anonymous") {
    return <Navigate replace to={`/login?next=${encodeURIComponent(next)}`} />;
  }
  return children;
}
