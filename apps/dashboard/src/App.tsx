import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, apiRequest, errorMessage, formatAtomic, isApiNotConfigured, parseUnits, prettyJson, shortAddress, rememberCsrfToken } from "./api";
import type { Agent, Approval, Passport, SimulationRun, User, Wallet } from "./types";

type Page = "overview" | "wallets" | "agents" | "approvals" | "passports" | "simulation" | "risk";
type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "not-configured" | "error";

const navigation: Array<{ id: Page; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "wallets", label: "Wallets" },
  { id: "agents", label: "Agents" },
  { id: "approvals", label: "Approvals" },
  { id: "passports", label: "Decision Passports" },
  { id: "simulation", label: "Simulation" },
  { id: "risk", label: "ARE / risk proposals" },
];

const pageCopy: Record<Page, { title: string; description: string }> = {
  overview: { title: "Overview", description: "Account and wallet information returned by the Aegis API." },
  wallets: { title: "Wallets", description: "Select a wallet, view its current API-reported details, and prepare a transfer call." },
  agents: { title: "Agents", description: "Agents associated with the selected wallet." },
  approvals: { title: "Approvals", description: "Review requests and prepare owner calls. This dashboard does not execute calls." },
  passports: { title: "Decision Passports", description: "Create a lab passport sample or verify a supplied passport with the Worker API." },
  simulation: { title: "Deterministic simulation", description: "Run a seeded simulation and retrieve its result by run ID." },
  risk: { title: "ARE / risk proposals", description: "Submit a manually supplied observation to the advisory agent proposal endpoint." },
};

function Alert({ children, kind = "error" }: { children: ReactNode; kind?: "error" | "info" | "success" }) {
  return <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>;
}

function Loading({ label = "Loading…" }: { label?: string }) {
  return <p className="muted" role="status">{label}</p>;
}

function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

function AuthPanel({
  apiUnavailable,
  initialError,
  onAuthenticated,
}: {
  apiUnavailable: boolean;
  initialError: string;
  onAuthenticated: (user: User) => void;
}) {
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
        const response = await apiRequest<{ user: User; csrfToken?: string }>("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        });
        if (response.csrfToken) rememberCsrfToken(response.csrfToken);
        onAuthenticated(response.user);
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-card" aria-labelledby="auth-heading">
        <p className="eyebrow">Aegis API dashboard</p>
        <h1 id="auth-heading">{mode === "login" ? "Sign in" : "Create an account"}</h1>
        <p className="muted">Use an account configured on the Aegis Worker API.</p>
        {apiUnavailable && (
          <Alert>
            API not configured or unreachable. Set <code>VITE_API_BASE_URL</code>, or serve the dashboard behind a host that routes <code>/api</code> to the Worker.
          </Alert>
        )}
        {!apiUnavailable && initialError && <Alert>{initialError}</Alert>}
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
      </section>
    </div>
  );
}

function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return <div className="key-value"><dt>{label}</dt><dd>{children}</dd></div>;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="json-block">{prettyJson(value)}</pre>;
}

function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState("");
  const [page, setPage] = useState<Page>("overview");
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(false);
  const [walletsError, setWalletsError] = useState("");
  const [selectedWalletId, setSelectedWalletId] = useState("");
  const [walletDetail, setWalletDetail] = useState<Wallet | null>(null);
  const [walletDetailLoading, setWalletDetailLoading] = useState(false);
  const [walletDetailError, setWalletDetailError] = useState("");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState("");
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(false);
  const [approvalsError, setApprovalsError] = useState("");
  const [refreshCount, setRefreshCount] = useState(0);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferError, setTransferError] = useState("");
  const [transferResult, setTransferResult] = useState<unknown>(null);
  const [approvalBusyId, setApprovalBusyId] = useState("");
  const [approvalRecipient, setApprovalRecipient] = useState("");
  const [approvalError, setApprovalError] = useState("");
  const [approvalPrepared, setApprovalPrepared] = useState<unknown>(null);
  const [passportScenario, setPassportScenario] = useState("safe-payment");
  const [passportBusy, setPassportBusy] = useState(false);
  const [passportError, setPassportError] = useState("");
  const [passport, setPassport] = useState<Passport | null>(null);
  const [passportText, setPassportText] = useState("");
  const [passportVerification, setPassportVerification] = useState<unknown>(null);
  const [expectedPreviousHash, setExpectedPreviousHash] = useState("");
  const [simulationForm, setSimulationForm] = useState({
    seed: "42",
    days: "7",
    startingBalance: "15",
    dailyBurn: "1",
    profile: "scripted-safe",
    attackTicks: "",
  });
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [simulationError, setSimulationError] = useState("");
  const [simulationId, setSimulationId] = useState("");
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);
  const [riskForm, setRiskForm] = useState({
    agentId: "",
    balance: "",
    chainTimestamp: "",
    paused: "",
    sessionKeyActive: "",
    keyValidAfter: "",
    keyValidUntil: "",
    spentToday: "",
    gasReservedTodayWei: "",
    pendingApprovals: "",
    approvalRequestsToday: "",
    lastActions: "[]",
    untrustedPageText: "",
  });
  const [riskBusy, setRiskBusy] = useState(false);
  const [riskError, setRiskError] = useState("");
  const [riskProposal, setRiskProposal] = useState<unknown>(null);
  const pageInfo = pageCopy[page];

  function handleExpiredSession(error: unknown): boolean {
    if (!(error instanceof ApiError) || error.status !== 401) return false;
    setUser(null);
    setAuthStatus("unauthenticated");
    setAuthError("Your session expired. Sign in again to continue.");
    setWallets([]);
    setWalletDetail(null);
    setAgents([]);
    setApprovals([]);
    setSelectedWalletId("");
    return true;
  }

  useEffect(() => {
    let current = true;
    apiRequest<{ user?: User }>("/auth/me")
      .then((response) => {
        if (!current) return;
        if (!response?.user || typeof response.user.id !== "string" || typeof response.user.email !== "string") {
          throw new ApiError("The API did not return an auth session. Check the API base URL.", 404);
        }
        setUser(response.user);
        setAuthStatus("authenticated");
      })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (requestError instanceof ApiError && requestError.status === 401) {
          setAuthStatus("unauthenticated");
          return;
        }
        if (isApiNotConfigured(requestError)) {
          setAuthStatus("not-configured");
          setAuthError(errorMessage(requestError));
          return;
        }
        setAuthStatus("error");
        setAuthError(errorMessage(requestError));
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
        const nextWallets = Array.isArray(response.wallets) ? response.wallets : [];
        setWallets(nextWallets);
        setSelectedWalletId((previous) => previous && nextWallets.some((wallet) => wallet.id === previous)
          ? previous
          : nextWallets[0]?.id ?? "");
      })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (handleExpiredSession(requestError)) return;
        setWalletsError(errorMessage(requestError));
        setWallets([]);
        setSelectedWalletId("");
      })
      .finally(() => { if (current) setWalletsLoading(false); });
    return () => { current = false; };
  }, [authStatus, refreshCount]);

  useEffect(() => {
    if (authStatus !== "authenticated" || !selectedWalletId) {
      setWalletDetail(null);
      setAgents([]);
      setApprovals([]);
      setWalletDetailError("");
      setAgentsError("");
      setApprovalsError("");
      return;
    }
    let current = true;
    setWalletDetailLoading(true);
    setAgentsLoading(true);
    setApprovalsLoading(true);
    setWalletDetailError("");
    setAgentsError("");
    setApprovalsError("");

    apiRequest<{ wallet: Wallet; balance?: Wallet["balance"]; error?: string }>(`/wallets/${encodeURIComponent(selectedWalletId)}`)
      .then((response) => {
        if (!current) return;
        setWalletDetail({ ...response.wallet, balance: response.balance ?? response.wallet.balance ?? null });
        setWalletDetailError(response.error ?? "");
      })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (!handleExpiredSession(requestError)) setWalletDetailError(errorMessage(requestError));
      })
      .finally(() => { if (current) setWalletDetailLoading(false); });

    apiRequest<{ agents: Agent[] }>(`/agents?walletId=${encodeURIComponent(selectedWalletId)}`)
      .then((response) => { if (current) setAgents(Array.isArray(response.agents) ? response.agents : []); })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (!handleExpiredSession(requestError)) setAgentsError(errorMessage(requestError));
      })
      .finally(() => { if (current) setAgentsLoading(false); });

    apiRequest<{ approvals: Approval[] }>(`/approvals?walletId=${encodeURIComponent(selectedWalletId)}`)
      .then((response) => { if (current) setApprovals(Array.isArray(response.approvals) ? response.approvals : []); })
      .catch((requestError: unknown) => {
        if (!current) return;
        if (!handleExpiredSession(requestError)) setApprovalsError(errorMessage(requestError));
      })
      .finally(() => { if (current) setApprovalsLoading(false); });

    return () => { current = false; };
  }, [authStatus, selectedWalletId, refreshCount]);

  const selectedWallet = useMemo(
    () => walletDetail?.id === selectedWalletId ? walletDetail : wallets.find((wallet) => wallet.id === selectedWalletId) ?? null,
    [walletDetail, wallets, selectedWalletId],
  );
  const pendingApprovalCount = approvals.filter((approval) => approval.status === "pending").length;

  function completeLogin(nextUser: User) {
    setUser(nextUser);
    setAuthStatus("authenticated");
    setAuthError("");
    setPage("overview");
  }

  async function signOut() {
    try {
      await apiRequest<{ ok: boolean }>("/auth/logout", { method: "POST", body: "{}" });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) setAuthError(errorMessage(error));
    }
    setUser(null);
    setAuthStatus("unauthenticated");
    setWallets([]);
    setWalletDetail(null);
    setAgents([]);
    setApprovals([]);
    setSelectedWalletId("");
  }

  async function prepareTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWalletId) return;
    setTransferError("");
    setTransferResult(null);
    setTransferBusy(true);
    try {
      const amount = parseUnits(transferAmount, 6);
      const result = await apiRequest<unknown>(`/wallets/${encodeURIComponent(selectedWalletId)}/transfers/prepare`, {
        method: "POST",
        body: JSON.stringify({ recipient: transferRecipient.trim(), amount }),
      });
      setTransferResult(result);
      setTransferAmount("");
      setTransferRecipient("");
      setRefreshCount((count) => count + 1);
    } catch (error) {
      if (!handleExpiredSession(error)) setTransferError(errorMessage(error));
    } finally {
      setTransferBusy(false);
    }
  }

  async function prepareApproval(approval: Approval, action: "approve" | "deny" | "whitelist") {
    if (!selectedWalletId) return;
    const key = `${approval.request_id}:${action}`;
    setApprovalBusyId(key);
    setApprovalError("");
    setApprovalPrepared(null);
    try {
      const body: { walletId: string; recipient?: string } = { walletId: selectedWalletId };
      if (action === "whitelist" && approvalRecipient.trim()) body.recipient = approvalRecipient.trim();
      const result = await apiRequest<unknown>(`/approvals/${encodeURIComponent(String(approval.request_id))}/${action}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setApprovalPrepared(result);
    } catch (error) {
      if (!handleExpiredSession(error)) setApprovalError(errorMessage(error));
    } finally {
      setApprovalBusyId("");
    }
  }

  async function createPassport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPassportBusy(true);
    setPassportError("");
    setPassportVerification(null);
    try {
      const result = await apiRequest<{ scenario: string; attackLabel: string; passport: Passport }>("/lab/passports", {
        method: "POST",
        body: JSON.stringify({ scenario: passportScenario }),
      });
      setPassport(result.passport);
      setPassportText(prettyJson(result.passport));
    } catch (error) {
      setPassportError(errorMessage(error));
    } finally {
      setPassportBusy(false);
    }
  }

  async function verifyPassport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPassportError("");
    setPassportVerification(null);
    try {
      const parsedPassport: unknown = JSON.parse(passportText);
      const body: { passport: unknown; expectedPreviousHash?: string } = { passport: parsedPassport };
      if (expectedPreviousHash.trim()) body.expectedPreviousHash = expectedPreviousHash.trim();
      const result = await apiRequest<unknown>("/passports/verify", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setPassportVerification(result);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setPassportVerification(error.payload ?? { valid: false, error: error.message });
        setPassportError("The verifier reported that this passport is invalid.");
      } else {
        setPassportError(error instanceof SyntaxError ? "Passport input must be valid JSON." : errorMessage(error));
      }
    }
  }

  async function loadSimulation(id: string) {
    if (!id.trim()) {
      setSimulationError("Enter a simulation run ID.");
      return;
    }
    setSimulationBusy(true);
    setSimulationError("");
    try {
      const result = await apiRequest<SimulationRun>(`/sim/runs/${encodeURIComponent(id.trim())}`);
      setSimulationRun(result);
      setSimulationId(id.trim());
    } catch (error) {
      setSimulationRun(null);
      setSimulationError(errorMessage(error));
    } finally {
      setSimulationBusy(false);
    }
  }

  async function runSimulation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSimulationBusy(true);
    setSimulationError("");
    setSimulationRun(null);
    try {
      const seed = Number(simulationForm.seed);
      const days = Number(simulationForm.days);
      if (!Number.isSafeInteger(seed)) throw new Error("Seed must be a safe integer.");
      if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error("Days must be between 1 and 30.");
      const attackTickParts = simulationForm.attackTicks.trim()
        ? simulationForm.attackTicks.split(",").map((tick) => tick.trim())
        : [];
      if (attackTickParts.some((tick) => !/^\d+$/.test(tick))) {
        throw new Error("Attack days must be comma-separated whole-number day indexes.");
      }
      const attackTicks = attackTickParts.map(Number);
      if (attackTicks.some((tick) => !Number.isInteger(tick) || tick < 0 || tick >= days)) {
        throw new Error(`Attack ticks must be whole day indexes from 0 to ${days - 1}.`);
      }
      const created = await apiRequest<{ id: string }>("/sim/runs", {
        method: "POST",
        body: JSON.stringify({
          seed,
          days,
          startingBalance: parseUnits(simulationForm.startingBalance, 6, true),
          dailyBurn: parseUnits(simulationForm.dailyBurn, 6, true),
          profile: simulationForm.profile,
          attackTicks,
        }),
      });
      setSimulationId(created.id);
      const fullRun = await apiRequest<SimulationRun>(`/sim/runs/${encodeURIComponent(created.id)}`);
      setSimulationRun(fullRun);
    } catch (error) {
      setSimulationError(errorMessage(error));
    } finally {
      setSimulationBusy(false);
    }
  }

  async function requestRiskProposal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRiskBusy(true);
    setRiskError("");
    setRiskProposal(null);
    try {
      let lastActions: unknown;
      try {
        lastActions = JSON.parse(riskForm.lastActions);
      } catch {
        throw new Error("Recent actions must be valid JSON.");
      }
      if (!Array.isArray(lastActions)) throw new Error("Recent actions must be a JSON array.");
      const boolValue = (value: string, field: string) => {
        if (value === "true") return true;
        if (value === "false") return false;
        throw new Error(`Choose yes or no for ${field}.`);
      };
      const result = await apiRequest<unknown>("/lab/agent-proposal", {
        method: "POST",
        body: JSON.stringify({
          agentId: riskForm.agentId,
          balance: riskForm.balance,
          chainTimestamp: Number(riskForm.chainTimestamp),
          context: {
            schemaVersion: 1,
            chainTimestamp: Number(riskForm.chainTimestamp),
            paused: boolValue(riskForm.paused, "Paused"),
            sessionKeyActive: boolValue(riskForm.sessionKeyActive, "Session key active"),
            keyValidAfter: Number(riskForm.keyValidAfter),
            keyValidUntil: Number(riskForm.keyValidUntil),
            spentToday: riskForm.spentToday,
            gasReservedTodayWei: riskForm.gasReservedTodayWei,
            pendingApprovals: Number(riskForm.pendingApprovals),
            approvalRequestsToday: Number(riskForm.approvalRequestsToday),
          },
          lastActions,
          ...(riskForm.untrustedPageText ? { untrustedPageText: riskForm.untrustedPageText } : {}),
        }),
      });
      setRiskProposal(result);
    } catch (error) {
      setRiskError(errorMessage(error));
    } finally {
      setRiskBusy(false);
    }
  }

  if (authStatus === "loading") {
    return <div className="loading-page"><Loading label="Checking API session…" /></div>;
  }

  if (authStatus !== "authenticated" || !user) {
    return (
      <AuthPanel
        apiUnavailable={authStatus === "not-configured"}
        initialError={authError}
        onAuthenticated={completeLogin}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-heading">
          <strong>Aegis</strong>
          <span>API dashboard</span>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? " nav-item-active" : ""}`}
              type="button"
              aria-current={page === item.id ? "page" : undefined}
              onClick={() => setPage(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span>Signed in as</span>
          <strong title={user.email}>{user.email}</strong>
          <button className="button button-secondary button-full" type="button" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><strong>Aegis</strong><span>API dashboard</span></div>
          <div className="topbar-controls">
            {wallets.length > 0 && (
              <label className="wallet-quick-select">
                <span>Wallet</span>
                <select value={selectedWalletId} onChange={(event) => setSelectedWalletId(event.target.value)} aria-label="Select wallet">
                  {wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{shortAddress(wallet.address)}</option>)}
                </select>
              </label>
            )}
            <button className="button button-secondary" type="button" onClick={() => setRefreshCount((count) => count + 1)} disabled={walletsLoading}>
              {walletsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <div className="content-area">
          <div className="page-heading">
            <div>
              <h1>{pageInfo.title}</h1>
              <p className="muted">{pageInfo.description}</p>
            </div>
            <span className="session-label">Signed in · {user.email}</span>
          </div>

          {walletsError && page !== "simulation" && page !== "passports" && page !== "risk" && <Alert>{walletsError}</Alert>}

          {page === "overview" && (
            <>
              {walletsLoading && <Loading label="Loading wallets…" />}
              {!walletsLoading && wallets.length === 0 && !walletsError && (
                <section className="panel"><Empty title="No wallets found">This account has no wallet returned by the API. Wallet enrollment is not part of this temporary dashboard.</Empty></section>
              )}
              <div className="summary-grid">
                <section className="summary-card"><span>Wallets</span><strong>{walletsLoading ? "…" : walletsError ? "—" : wallets.length}</strong></section>
                <section className="summary-card"><span>Agents · selected wallet</span><strong>{agentsLoading ? "…" : agentsError ? "—" : selectedWalletId ? agents.length : "—"}</strong></section>
                <section className="summary-card"><span>Pending approvals</span><strong>{approvalsLoading ? "…" : approvalsError ? "—" : selectedWalletId ? pendingApprovalCount : "—"}</strong></section>
              </div>
              {selectedWallet && (
                <section className="panel">
                  <div className="panel-heading"><h2>Selected wallet</h2><button className="text-button" type="button" onClick={() => setPage("wallets")}>View wallet details</button></div>
                  <dl className="detail-grid">
                    <KeyValue label="Address"><code title={selectedWallet.address}>{selectedWallet.address}</code></KeyValue>
                    <KeyValue label="Chain ID">{selectedWallet.chain_id ?? selectedWallet.chainId ?? "Not available"}</KeyValue>
                    <KeyValue label="USDC balance">{selectedWallet.balance ? `${formatAtomic(selectedWallet.balance.atomic, selectedWallet.balance.decimals)} ${selectedWallet.balance.symbol}` : "Not available"}</KeyValue>
                    <KeyValue label="Deployment">{selectedWallet.deployment_status ?? selectedWallet.deploymentStatus ?? "Not available"}</KeyValue>
                  </dl>
                </section>
              )}
              {walletDetailError && <Alert kind="info">Wallet details: {walletDetailError}</Alert>}
              {agentsError && <Alert kind="info">Agent data: {agentsError}</Alert>}
              {approvalsError && <Alert kind="info">Approval data: {approvalsError}</Alert>}
            </>
          )}

          {page === "wallets" && (
            <div className="page-stack">
              {walletsLoading && <Loading label="Loading wallets…" />}
              {!walletsLoading && wallets.length === 0 && !walletsError && (
                <section className="panel"><Empty title="No wallets found">The API returned no wallets for this account. This dashboard does not include wallet enrollment.</Empty></section>
              )}
              {wallets.length > 0 && (
                <section className="panel">
                  <div className="panel-heading"><h2>Wallet details</h2><label className="inline-select"><span>Select wallet</span><select value={selectedWalletId} onChange={(event) => setSelectedWalletId(event.target.value)}>{wallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{shortAddress(wallet.address)} · chain {wallet.chain_id ?? wallet.chainId ?? "?"}</option>)}</select></label></div>
                  {walletDetailLoading && <Loading label="Loading wallet details…" />}
                  {walletDetailError && <Alert kind="info">{walletDetailError}</Alert>}
                  {selectedWallet && (
                    <dl className="detail-grid">
                      <KeyValue label="Wallet ID"><code>{selectedWallet.id}</code></KeyValue>
                      <KeyValue label="Wallet address"><code>{selectedWallet.address}</code></KeyValue>
                      <KeyValue label="Owner address"><code>{selectedWallet.owner_address ?? selectedWallet.ownerAddress ?? "Not available"}</code></KeyValue>
                      <KeyValue label="Chain ID">{selectedWallet.chain_id ?? selectedWallet.chainId ?? "Not available"}</KeyValue>
                      <KeyValue label="Environment">{selectedWallet.env ?? "Not available"}</KeyValue>
                      <KeyValue label="Deployment status">{selectedWallet.deployment_status ?? selectedWallet.deploymentStatus ?? "Not available"}</KeyValue>
                      <KeyValue label="Deployment transaction"><code>{selectedWallet.deployment_tx_hash ?? "Not available"}</code></KeyValue>
                      <KeyValue label="USDC balance">{selectedWallet.balance ? `${formatAtomic(selectedWallet.balance.atomic, selectedWallet.balance.decimals)} ${selectedWallet.balance.symbol}` : "Not available"}</KeyValue>
                      <KeyValue label="Balance read status">{selectedWallet.balanceError ?? (selectedWallet.balance ? "Available" : "Not reported")}</KeyValue>
                    </dl>
                  )}
                </section>
              )}

              {selectedWalletId && (
                <section className="panel">
                  <h2>Prepare a USDC transfer</h2>
                  <p className="muted">This calls the API prepare endpoint. The returned call is not signed, submitted, or confirmed here.</p>
                  {transferError && <Alert>{transferError}</Alert>}
                  <form className="form-grid" onSubmit={prepareTransfer}>
                    <label className="form-span-2">Recipient address<input value={transferRecipient} onChange={(event) => setTransferRecipient(event.target.value)} placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" required /></label>
                    <label>Amount (USDC)<input type="number" inputMode="decimal" min="0.000001" step="0.000001" value={transferAmount} onChange={(event) => setTransferAmount(event.target.value)} required /></label>
                    <div className="form-actions"><button className="button button-primary" type="submit" disabled={transferBusy}>{transferBusy ? "Preparing…" : "Prepare transfer"}</button></div>
                  </form>
                  {transferResult !== null ? <div className="result-block"><Alert kind="info">Prepared call (unsigned) — not submitted or confirmed.</Alert><JsonBlock value={transferResult} /></div> : null}
                </section>
              )}
            </div>
          )}

          {page === "agents" && (
            <section className="panel">
              {!selectedWalletId && <Empty title="Select a wallet">Agent records are loaded for the selected wallet.</Empty>}
              {selectedWalletId && agentsLoading && <Loading label="Loading agents…" />}
              {agentsError && <Alert>{agentsError}</Alert>}
              {selectedWalletId && !agentsLoading && !agentsError && agents.length === 0 && <Empty title="No agents found">The API returned no agents for this wallet.</Empty>}
              {agents.length > 0 && (
                <div className="table-wrap"><table>
                  <thead><tr><th>Name</th><th>Status</th><th>Profile</th><th>Session key</th><th>Agent ID</th></tr></thead>
                  <tbody>{agents.map((agent) => <tr key={agent.id}><td>{agent.name}</td><td><span className={`status status-${agent.status}`}>{agent.status}</span></td><td>{agent.profile}</td><td><code title={agent.session_key_address}>{shortAddress(agent.session_key_address)}</code></td><td><code>{agent.id}</code></td></tr>)}</tbody>
                </table></div>
              )}
              <p className="field-help section-note">Agent enrollment and revocation are not included in this temporary dashboard.</p>
            </section>
          )}

          {page === "approvals" && (
            <section className="panel">
              <p className="muted">Preparing an approval action returns a call requiring an owner signature. No action below submits or confirms a transaction.</p>
              {!selectedWalletId && <Empty title="Select a wallet">Approval requests are loaded for the selected wallet.</Empty>}
              {selectedWalletId && approvalsLoading && <Loading label="Loading approvals…" />}
              {approvalsError && <Alert>{approvalsError}</Alert>}
              {selectedWalletId && !approvalsLoading && !approvalsError && approvals.length === 0 && <Empty title="No approval requests">The API returned no approval requests for this wallet.</Empty>}
              {approvals.length > 0 && (
                <div className="table-wrap"><table>
                  <thead><tr><th>Request</th><th>Agent</th><th>Target</th><th>Amount</th><th>Status</th><th>Reason</th><th>Prepare owner call</th></tr></thead>
                  <tbody>{approvals.map((approval) => (
                    <tr key={approval.id}>
                      <td>{approval.request_id}</td>
                      <td><code>{shortAddress(approval.agent_id)}</code></td>
                      <td><code title={approval.target}>{shortAddress(approval.target)}</code></td>
                      <td>{formatAtomic(approval.amount)} USDC</td>
                      <td><span className={`status status-${approval.status}`}>{approval.status}</span></td>
                      <td>{approval.reason || "—"}</td>
                      <td><div className="row-actions">
                        <button className="button button-small" type="button" disabled={Boolean(approvalBusyId) || approval.status !== "pending"} onClick={() => prepareApproval(approval, "approve")}>{approvalBusyId === `${approval.request_id}:approve` ? "Preparing…" : "Prepare approve"}</button>
                        <button className="button button-small" type="button" disabled={Boolean(approvalBusyId) || approval.status !== "pending"} onClick={() => prepareApproval(approval, "deny")}>{approvalBusyId === `${approval.request_id}:deny` ? "Preparing…" : "Prepare deny"}</button>
                        <button className="button button-small" type="button" disabled={Boolean(approvalBusyId) || approval.status !== "pending"} onClick={() => prepareApproval(approval, "whitelist")}>{approvalBusyId === `${approval.request_id}:whitelist` ? "Preparing…" : "Prepare allow"}</button>
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
              {approvals.length > 0 && (
                <label className="recipient-input">Optional recipient for allow call<input value={approvalRecipient} onChange={(event) => setApprovalRecipient(event.target.value)} placeholder="0x… (leave blank to use API default)" pattern="^$|^0x[0-9a-fA-F]{40}$" /></label>
              )}
              {approvalError && <Alert>{approvalError}</Alert>}
              {approvalPrepared !== null ? <div className="result-block"><Alert kind="info">Prepared for owner signature — not signed, executed, or confirmed.</Alert><JsonBlock value={approvalPrepared} /></div> : null}
            </section>
          )}

          {page === "passports" && (
            <div className="page-stack">
              <section className="panel">
                <h2>Create a lab passport sample</h2>
                <p className="muted">Lab endpoint only. A generated sample is not a wallet transaction or on-chain record.</p>
                <form className="form-grid" onSubmit={createPassport}>
                  <label>Scenario<select value={passportScenario} onChange={(event) => setPassportScenario(event.target.value)}>
                    <option value="safe-payment">Safe payment</option>
                    <option value="prompt-injection">Prompt injection</option>
                    <option value="revoked-key">Revoked key</option>
                    <option value="approval-queue-flood">Approval queue full</option>
                  </select></label>
                  <div className="form-actions"><button className="button button-primary" type="submit" disabled={passportBusy}>{passportBusy ? "Creating…" : "Create lab passport"}</button></div>
                </form>
                {passportError && <Alert>{passportError}</Alert>}
                {passport?.evaluation?.trace && (
                  <div className="table-wrap trace-table"><table>
                    <thead><tr><th>Rule</th><th>Status</th><th>Severity</th><th>Expected</th><th>Observed</th><th>Evidence</th></tr></thead>
                    <tbody>{passport.evaluation.trace.map((rule) => <tr key={rule.id}><td>{rule.id}</td><td><span className={`status status-${rule.status}`}>{rule.status}</span></td><td>{rule.severity}</td><td>{rule.expected}</td><td>{rule.observed}</td><td>{rule.explanation}</td></tr>)}</tbody>
                  </table></div>
                )}
                {passport && <div className="result-block"><p><strong>Passport hash:</strong> <code>{passport.passportHash ?? "Not returned"}</code></p><JsonBlock value={passport} /></div>}
              </section>

              <section className="panel">
                <h2>Verify a passport</h2>
                <p className="muted">Verification is performed by <code>POST /api/passports/verify</code>. Paste a passport JSON object or use the sample above.</p>
                <form className="form-stack" onSubmit={verifyPassport}>
                  <label>Passport JSON<textarea rows={12} value={passportText} onChange={(event) => setPassportText(event.target.value)} placeholder="Paste a Decision Passport JSON object" required /></label>
                  <label>Expected previous hash (optional)<input value={expectedPreviousHash} onChange={(event) => setExpectedPreviousHash(event.target.value)} placeholder="0x + 64 hex characters" pattern="^$|^0x[0-9a-fA-F]{64}$" /></label>
                  <div className="form-actions"><button className="button button-primary" type="submit" disabled={!passportText.trim()}>Verify passport</button><button className="button button-secondary" type="button" disabled={!passport} onClick={() => setPassportText(prettyJson(passport))}>Load generated sample</button></div>
                </form>
                {passportError && <Alert>{passportError}</Alert>}
                {passportVerification !== null ? <div className="result-block"><JsonBlock value={passportVerification} /></div> : null}
              </section>
            </div>
          )}

          {page === "simulation" && (
            <div className="page-stack">
              <section className="panel">
                <h2>Run configuration</h2>
                <p className="muted">Amounts use USDC units in this form and are sent as six-decimal atomic integers. Runs affect only the deterministic simulation.</p>
                {simulationError && <Alert>{simulationError}</Alert>}
                <form className="form-grid" onSubmit={runSimulation}>
                  <label>Seed<input type="number" step="1" value={simulationForm.seed} onChange={(event) => setSimulationForm({ ...simulationForm, seed: event.target.value })} required /></label>
                  <label>Days<input type="number" min="1" max="30" step="1" value={simulationForm.days} onChange={(event) => setSimulationForm({ ...simulationForm, days: event.target.value })} required /></label>
                  <label>Starting balance (USDC)<input type="number" min="0" step="0.000001" value={simulationForm.startingBalance} onChange={(event) => setSimulationForm({ ...simulationForm, startingBalance: event.target.value })} required /></label>
                  <label>Daily burn (USDC)<input type="number" min="0" step="0.000001" value={simulationForm.dailyBurn} onChange={(event) => setSimulationForm({ ...simulationForm, dailyBurn: event.target.value })} required /></label>
                  <label>Profile<select value={simulationForm.profile} onChange={(event) => setSimulationForm({ ...simulationForm, profile: event.target.value })}><option value="scripted-safe">Scripted safe</option><option value="scripted-adaptive">Scripted adaptive</option></select></label>
                  <label>Attack day indexes<input value={simulationForm.attackTicks} onChange={(event) => setSimulationForm({ ...simulationForm, attackTicks: event.target.value })} placeholder="Optional; e.g. 2, 4" /></label>
                  <div className="form-span-2 form-actions"><button className="button button-primary" type="submit" disabled={simulationBusy}>{simulationBusy ? "Running…" : "Run simulation"}</button></div>
                </form>
              </section>
              <section className="panel">
                <h2>Load a run</h2>
                <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void loadSimulation(simulationId); }}>
                  <label className="grow">Run ID<input value={simulationId} onChange={(event) => setSimulationId(event.target.value)} placeholder="Simulation run ID" /></label>
                  <button className="button button-secondary" type="submit" disabled={simulationBusy || !simulationId.trim()}>{simulationBusy ? "Loading…" : "Load run"}</button>
                </form>
                {simulationRun?.summary && (
                  <>
                    <dl className="detail-grid simulation-summary">
                      <KeyValue label="Seed">{simulationRun.summary.seed ?? "—"}</KeyValue>
                      <KeyValue label="Ticks">{simulationRun.summary.ticks ?? "—"}</KeyValue>
                      <KeyValue label="Alive">{typeof simulationRun.summary.alive === "boolean" ? (simulationRun.summary.alive ? "Yes" : "No") : "—"}</KeyValue>
                      <KeyValue label="Ending balance">{simulationRun.summary.endingBalance !== undefined ? `${formatAtomic(simulationRun.summary.endingBalance)} USDC` : "—"}</KeyValue>
                      <KeyValue label="Total burned">{simulationRun.summary.totalBurned !== undefined ? `${formatAtomic(simulationRun.summary.totalBurned)} USDC` : "—"}</KeyValue>
                      <KeyValue label="Blocked attacks">{simulationRun.summary.blockedAttacks ?? "—"}</KeyValue>
                      <KeyValue label="Event hash"><code>{simulationRun.summary.eventHash ?? "—"}</code></KeyValue>
                      <KeyValue label="Passport head"><code>{simulationRun.summary.passportHead ?? "None"}</code></KeyValue>
                    </dl>
                    {simulationRun.summary.decisions && <p className="muted">Decisions returned: allow {simulationRun.summary.decisions.allow}, needs approval {simulationRun.summary.decisions.needs_approval}, deny {simulationRun.summary.decisions.deny}.</p>}
                  </>
                )}
                {simulationRun?.events && simulationRun.events.length > 0 && (
                  <div className="table-wrap"><table>
                    <thead><tr><th>#</th><th>Day</th><th>Event</th><th>Amount</th><th>Balance</th><th>Details</th><th>Passport</th></tr></thead>
                    <tbody>{simulationRun.events.map((event, index) => <tr key={`${String(event.seq ?? index)}-${String(event.kind ?? "event")}`}><td>{String(event.seq ?? index + 1)}</td><td>{String(event.tick ?? "—")}</td><td>{String(event.kind ?? "—")}</td><td>{event.amount !== undefined ? `${formatAtomic(String(event.amount))} USDC` : "—"}</td><td>{event.balance !== undefined ? `${formatAtomic(String(event.balance))} USDC` : "—"}</td><td>{String(event.detail ?? "—")}</td><td><code>{shortAddress(event.passportHash)}</code></td></tr>)}</tbody>
                  </table></div>
                )}
                {simulationRun && (!simulationRun.events || simulationRun.events.length === 0) && <Empty title="Run returned without events">No events were included in this API response.</Empty>}
              </section>
            </div>
          )}

          {page === "risk" && (
            <div className="page-stack">
              <section className="panel">
                <h2>Manual observation</h2>
                <Alert kind="info">Advisory only. The proposal has no signing or execution authority and remains inactive until separately reviewed and authorized by an owner. This form does not confirm or submit a proposal.</Alert>
                <p className="muted">Provide a current observation yourself. These fields are not read from a wallet or chain by this dashboard. Recent actions must be a JSON array.</p>
                {riskError && <Alert>{riskError}</Alert>}
                <form className="form-grid" onSubmit={requestRiskProposal}>
                  <label>Agent ID<input value={riskForm.agentId} onChange={(event) => setRiskForm({ ...riskForm, agentId: event.target.value })} required /></label>
                  <label>Balance (atomic units)<input inputMode="numeric" pattern="[0-9]+" value={riskForm.balance} onChange={(event) => setRiskForm({ ...riskForm, balance: event.target.value })} required /></label>
                  <label>Chain timestamp (seconds)<input type="number" min="0" step="1" value={riskForm.chainTimestamp} onChange={(event) => setRiskForm({ ...riskForm, chainTimestamp: event.target.value })} required /></label>
                  <label>Wallet paused?<select value={riskForm.paused} onChange={(event) => setRiskForm({ ...riskForm, paused: event.target.value })} required><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></select></label>
                  <label>Session key active?<select value={riskForm.sessionKeyActive} onChange={(event) => setRiskForm({ ...riskForm, sessionKeyActive: event.target.value })} required><option value="">Select…</option><option value="true">Yes</option><option value="false">No</option></select></label>
                  <label>Key valid after (seconds)<input type="number" min="0" step="1" value={riskForm.keyValidAfter} onChange={(event) => setRiskForm({ ...riskForm, keyValidAfter: event.target.value })} required /></label>
                  <label>Key valid until (seconds; 0 = no end)<input type="number" min="0" step="1" value={riskForm.keyValidUntil} onChange={(event) => setRiskForm({ ...riskForm, keyValidUntil: event.target.value })} required /></label>
                  <label>Spent today (atomic units)<input inputMode="numeric" pattern="[0-9]+" value={riskForm.spentToday} onChange={(event) => setRiskForm({ ...riskForm, spentToday: event.target.value })} required /></label>
                  <label>Gas reserved today (wei)<input inputMode="numeric" pattern="[0-9]+" value={riskForm.gasReservedTodayWei} onChange={(event) => setRiskForm({ ...riskForm, gasReservedTodayWei: event.target.value })} required /></label>
                  <label>Pending approvals<input type="number" min="0" step="1" value={riskForm.pendingApprovals} onChange={(event) => setRiskForm({ ...riskForm, pendingApprovals: event.target.value })} required /></label>
                  <label>Approval requests today<input type="number" min="0" step="1" value={riskForm.approvalRequestsToday} onChange={(event) => setRiskForm({ ...riskForm, approvalRequestsToday: event.target.value })} required /></label>
                  <label className="form-span-2">Recent actions JSON<textarea rows={4} value={riskForm.lastActions} onChange={(event) => setRiskForm({ ...riskForm, lastActions: event.target.value })} /></label>
                  <label className="form-span-2">Untrusted page text (optional)<textarea rows={3} value={riskForm.untrustedPageText} onChange={(event) => setRiskForm({ ...riskForm, untrustedPageText: event.target.value })} /></label>
                  <div className="form-span-2 form-actions"><button className="button button-primary" type="submit" disabled={riskBusy}>{riskBusy ? "Requesting proposal…" : "Request advisory proposal"}</button></div>
                </form>
              </section>
              {riskProposal !== null ? <section className="panel"><h2>Advisory result</h2><Alert kind="info">Proposal only — inactive; no wallet call was signed, submitted, or confirmed.</Alert><JsonBlock value={riskProposal} /></section> : null}
            </div>
          )}

          <footer className="page-footer">Temporary API test dashboard · No fabricated wallet or chain data is shown.</footer>
        </div>
      </main>
    </div>
  );
}

export default App;
