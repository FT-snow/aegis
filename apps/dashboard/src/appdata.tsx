import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, apiRequest, errorMessage } from "./api";
import type { User, Wallet } from "./types";
import { useRouter } from "./router";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AppDataValue {
  authStatus: AuthStatus;
  user: User | null;
  sessionExpiresAt: number | null;
  wallets: Wallet[];
  walletsLoading: boolean;
  walletsError: string;
  refresh: () => void;
  signIn: (user: User, csrfToken?: string) => void;
  signOut: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | null>(null);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { navigate } = useRouter();
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletsError, setWalletsError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let current = true;
    apiRequest<{ user?: User; expiresAt?: number }>("/auth/me")
      .then((response) => {
        if (!current) return;
        if (!response?.user || typeof response.user.id !== "string" || typeof response.user.email !== "string") {
          setAuthStatus("unauthenticated");
          return;
        }
        setUser(response.user);
        setSessionExpiresAt(typeof response.expiresAt === "number" ? response.expiresAt : null);
        setAuthStatus("authenticated");
      })
      .catch(() => {
        if (!current) return;
        setAuthStatus("unauthenticated");
      });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    let current = true;
    setWalletsLoading(true);
    setWalletsError("");
    apiRequest<{ wallets: Wallet[] }>("/wallets")
      .then((response) => {
        if (!current) return;
        setWallets(Array.isArray(response.wallets) ? response.wallets : []);
      })
      .catch((error: unknown) => {
        if (!current) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setAuthStatus("unauthenticated");
          navigate("/login", { replace: true });
          return;
        }
        setWalletsError(errorMessage(error));
        setWallets([]);
      })
      .finally(() => { if (current) setWalletsLoading(false); });
    return () => { current = false; };
  }, [authStatus, refreshCount, navigate]);

  const signIn = useCallback((nextUser: User, csrfToken?: string) => {
    if (csrfToken) {
      // The auth layer also remembers this; passed through for session continuity.
      void csrfToken;
    }
    setUser(nextUser);
    setAuthStatus("authenticated");
    setRefreshCount((count) => count + 1);
    navigate("/overview", { replace: true });
  }, [navigate]);

  const signOut = useCallback(async () => {
    try {
      await apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" });
    } catch {
      // Session may already be gone; clearing local state either way.
    }
    setUser(null);
    setSessionExpiresAt(null);
    setWallets([]);
    setAuthStatus("unauthenticated");
    navigate("/login", { replace: true });
  }, [navigate]);

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), []);

  const value = useMemo<AppDataValue>(() => ({
    authStatus,
    user,
    sessionExpiresAt,
    wallets,
    walletsLoading,
    walletsError,
    refresh,
    signIn,
    signOut,
  }), [authStatus, user, sessionExpiresAt, wallets, walletsLoading, walletsError, refresh, signIn, signOut]);

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const value = useContext(AppDataContext);
  if (!value) throw new Error("useAppData must be used within AppDataProvider");
  return value;
}
