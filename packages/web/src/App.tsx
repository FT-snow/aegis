import { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ConnectionIndicator } from "./components/ConnectionIndicator";
import { DashboardNav } from "./components/DashboardNav";
import { ThemeToggle } from "./components/ThemeToggle";
import { ToastProvider, useToast } from "./components/ToastProvider";
import { AuthProvider, useAuth } from "./lib/auth";
import { ArenaRoute } from "./routes/ArenaRoute";
import { DashboardSections } from "./routes/DashboardSections";
import { LandingPage, LoginPage } from "./routes/PublicRoutes";
import { RequireAuth } from "./routes/RequireAuth";
import {
  getAgents,
  getAuditTrail,
  getEvents,
  getPending,
  getPolicy,
  getWallet,
  revokeKey,
  setAgentPaused,
  subscribe,
} from "./lib/api";
import type {
  AegisEvent,
  AgentSummary,
  AuditDecision,
  ConnectionState,
  PendingRequest,
  Policy,
  WalletSummary,
} from "./lib/types";

declare global {
  interface Window {
    ethereum?: {
      request: (request: { method: string }) => Promise<unknown>;
      on?: (event: string, listener: (value: unknown) => void) => void;
      removeListener?: (event: string, listener: (value: unknown) => void) => void;
    };
  }
}

interface DashboardData {
  wallet: WalletSummary;
  policy: Policy;
  pending: PendingRequest[];
  events: AegisEvent[];
  audit: AuditDecision[];
  agents: AgentSummary[];
}

const navigation = [
  { path: "overview", label: "Overview" },
  { path: "wallets", label: "Wallets" },
  { path: "agents", label: "Agents" },
  { path: "transactions", label: "Transactions" },
  { path: "approvals", label: "Approvals" },
  { path: "security", label: "Security" },
  { path: "audit", label: "Audit trail" },
  { path: "logs", label: "Logs" },
  { path: "settings", label: "Settings" },
];

function eventKey(event: AegisEvent) {
  return [
    event.userOpHash,
    event.txHash,
    event.timestamp,
    event.environment,
    event.agentId,
    event.action,
    event.target,
    event.amount,
    event.decision,
    event.rule,
    event.reason,
  ].join("|");
}

function DashboardPage() {
  const { section = "overview" } = useParams();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>("offline");
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [ownerChainId, setOwnerChainId] = useState<number | null>(null);

  const refresh = useCallback(() => setRefreshVersion((version) => version + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([getWallet(), getPolicy(), getPending(), getEvents(), getAuditTrail(), getAgents()])
      .then(([wallet, policy, pending, events, audit, agents]) => {
        if (!cancelled) setData({ wallet, policy, pending, events, audit, agents });
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          toast.error(loadError instanceof Error ? loadError.message : "Dashboard data could not be loaded.");
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Dashboard data could not be loaded. Try again.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshVersion, toast]);

  useEffect(
    () =>
      subscribe((event) => {
        setData((current) => {
          if (!current) return current;
          const key = eventKey(event);
          const exists = current.events.some((item) => eventKey(item) === key);
          return exists
            ? current
            : { ...current, events: [event, ...current.events].slice(0, 100) };
        });
        if (
          event.decision === "pending" ||
          (event.rule === "expiry" && event.decision === "denied")
        ) {
          void getPending().then((pending) =>
            setData((current) => (current ? { ...current, pending } : current)),
          );
        }
        setLiveAnnouncement(`New ${event.decision} policy event: ${event.action}.`);
      }, setConnection),
    [],
  );

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;
    const chainChanged = (value: unknown) => {
      const chainId = typeof value === "string" ? Number.parseInt(value, 16) : Number.NaN;
      setOwnerChainId(chainId);
      if (chainId !== 84532) toast.error("Wrong network. Switch to Base Sepolia (84532).");
    };
    const accountsChanged = (value: unknown) => {
      setOwnerAddress(Array.isArray(value) && typeof value[0] === "string" ? value[0] : "");
    };
    provider.on("chainChanged", chainChanged);
    provider.on("accountsChanged", accountsChanged);
    return () => {
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("accountsChanged", accountsChanged);
    };
  }, [toast]);

  const setPaused = useCallback(
    async (paused: boolean) => {
      await setAgentPaused(paused);
      refresh();
    },
    [refresh],
  );

  const revoke = useCallback(async () => {
    await revokeKey();
    refresh();
  }, [refresh]);

  async function handleLogout() {
    try {
      await logout();
    } catch (logoutError) {
      toast.error(logoutError instanceof Error ? logoutError.message : "Could not log out. Try again.");
    } finally {
      navigate("/login");
    }
  }

  async function connectOwnerWallet() {
    if (!window.ethereum) {
      toast.error("No wallet found. Install or unlock one, then try again.");
      return;
    }
    try {
      const accounts = (await window.ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];
      const chainHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      if (!accounts[0])
        throw new Error("The browser wallet returned no account. Unlock it and try again.");
      const chainId = Number.parseInt(chainHex, 16);
      setOwnerAddress(accounts[0] ?? "");
      setOwnerChainId(chainId);
      if (chainId !== 84532)
        toast.error("Wrong network. Switch to Base Sepolia (84532), then try again.");
    } catch (connectError) {
      toast.error(
        connectError instanceof Error
          ? connectError.message
          : "Wallet connection was cancelled. Unlock the wallet and try again.",
      );
    }
  }

  const reportedChainId = data?.wallet.chainId;
  const chainMismatch =
    (reportedChainId !== undefined && reportedChainId !== 84532) ||
    (ownerChainId !== null && ownerChainId !== 84532);

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Link className="brand" to="/" aria-label="Aegis home">
          AEGIS<span className="brand-period">.</span>
        </Link>
        <div className="topbar-status">
          <span className="network-indicator">
            <span aria-hidden="true" className="status-symbol">
              ◆
            </span>
            Base Sepolia
          </span>
          <ConnectionIndicator state={connection} />
          <span className="owner-indicator" title={user?.email}>
            {ownerAddress
              ? `Owner · ${ownerAddress.slice(0, 6)}…${ownerAddress.slice(-4)}`
              : "Owner wallet · not connected"}
          </span>
          <ThemeToggle />
          {!ownerAddress && (
            <button
              className="button button-secondary button-sm connect-owner-button"
              onClick={() => void connectOwnerWallet()}
              type="button"
            >
              Connect owner wallet
            </button>
          )}
          <button
            className="button button-secondary button-sm"
            onClick={() => void handleLogout()}
            title={user?.email ? `Log out (${user.email})` : "Log out"}
            type="button"
          >
            Log out
          </button>
        </div>
      </header>

      {chainMismatch && (
        <div className="blocking-alert" role="alert">
          <strong>Unsupported network.</strong>{" "}
          {`Chain ID ${ownerChainId ?? reportedChainId} is not Base Sepolia (84532). Wallet actions are blocked.`}
        </div>
      )}

      <div className="app-frame">
        <aside className="sidebar">
          <p className="sidebar-label">Workspace</p>
          <nav aria-label="Dashboard navigation" className="sidebar-nav">
            {navigation.map((item) => (
              <NavLink
                className={({ isActive }) => `sidebar-link${isActive ? " is-active" : ""}`}
                key={item.path}
                to={`/app/${item.path}`}
              >
                <span>{item.label}</span>
                {item.path === "approvals" && data?.pending.length ? (
                  <span className="nav-count">{data.pending.length}</span>
                ) : null}
              </NavLink>
            ))}
            <NavLink
              className={({ isActive }) =>
                `sidebar-link sidebar-link-sim${isActive ? " is-active" : ""}`
              }
              to="/arena"
            >
              <span>Survival Arena</span>
              <span className="sim-mini-label">Sim</span>
            </NavLink>
          </nav>
          <div className="sidebar-footnote">
            <span className="sidebar-footnote-rule" aria-hidden="true" />
            <p>A programmable authorization layer for autonomous financial agents.</p>
          </div>
        </aside>

        <section className="app-content" aria-label="Dashboard content">
          <span className="sr-only" aria-live="polite" role="status">
            {liveAnnouncement}
          </span>
          {loading && !data ? <DashboardSkeleton /> : null}
          {error && !data ? (
            <div className="load-error" role="alert">
              <h1>Dashboard unavailable</h1>
              <p>{error}</p>
              <button className="button button-secondary" onClick={refresh} type="button">
                Retry loading dashboard
              </button>
            </div>
          ) : null}
          {error && data ? (
            <div className="load-error-inline" role="alert">
              <span>Refresh failed: {error}</span>
              <button className="button button-secondary" onClick={refresh} type="button">
                Retry
              </button>
            </div>
          ) : null}
          {data ? (
            <DashboardSections
              section={section}
              wallet={data.wallet}
              policy={data.policy}
              pending={data.pending}
              events={data.events}
              audit={data.audit}
              agents={data.agents}
              onRefresh={refresh}
              onPausedChange={setPaused}
              onRevoked={revoke}
              ownerAddress={ownerAddress}
              ownerChainId={ownerChainId}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="loading-state" aria-label="Loading dashboard" aria-live="polite">
      <p className="eyebrow">Loading workspace</p>
      <span className="skeleton skeleton-heading" />
      <span className="skeleton skeleton-row" />
      <span className="skeleton skeleton-row" />
      <span className="skeleton skeleton-row" />
    </div>
  );
}

function NotFoundPage() {
  return (
    <main className="not-found">
      <p className="eyebrow">404 / NOT FOUND</p>
      <h1>This page is not part of Aegis.</h1>
      <Link className="text-link" to="/">
        Return to the home page
      </Link>
    </main>
  );
}

function ProtectedApp() {
  const location = useLocation();
  const section = location.pathname.split("/")[2] ?? "overview";
  if (!navigation.some((item) => item.path === section)) return <NotFoundPage />;
  return (
    <Routes>
      <Route element={<DashboardPage />} index />
      <Route element={<DashboardPage />} path=":section" />
    </Routes>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<LandingPage />} path="/" />
      <Route element={<LoginPage />} path="/login" />
      <Route
        element={
          <RequireAuth>
            <ProtectedApp />
          </RequireAuth>
        }
        path="/app/*"
      />
      <Route element={<ArenaRoute />} path="/arena" />
      <Route element={<NotFoundPage />} path="*" />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
