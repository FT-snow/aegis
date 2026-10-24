import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  SESSION_LOST_MESSAGE,
  getSession,
  login as apiLogin,
  logout as apiLogout,
  onAuthLoss,
} from "./api";
import type { AuthUser } from "./types";
import { useToast } from "../components/ToastProvider";

export type AuthStatus = "loading" | "authenticated" | "anonymous";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  expired: string;
  login: (email: string, password: string) => Promise<AuthUser>;
  signup: (email: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  expired: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [state, setState] = useState<AuthState>({ status: "loading", user: null, expired: "" });

  useEffect(() => {
    let cancelled = false;
    getSession()
      .then((user) => {
        if (cancelled) return;
        setState({
          status: user ? "authenticated" : "anonymous",
          user,
          expired: "",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "anonymous", user: null, expired: "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () =>
      onAuthLoss((message) => {
        const text = message || SESSION_LOST_MESSAGE;
        setState({ status: "anonymous", user: null, expired: text });
        toast.error(text);
      }),
    [toast],
  );

  const signIn = useCallback(async (email: string, password: string, mode: "login" | "signup") => {
    const user = await apiLogin(email, password, mode);
    setState({ status: "authenticated", user, expired: "" });
    return user;
  }, []);

  const login = useCallback(
    (email: string, password: string) => signIn(email, password, "login"),
    [signIn],
  );
  const signup = useCallback(
    (email: string, password: string) => signIn(email, password, "signup"),
    [signIn],
  );

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setState({ status: "anonymous", user: null, expired: "" });
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        status: state.status,
        user: state.user,
        expired: state.expired,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider.");
  return value;
}
