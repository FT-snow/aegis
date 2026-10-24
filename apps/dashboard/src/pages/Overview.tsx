import { useEffect, useMemo, useState } from "react";
import { apiRequest, formatAtomic, shortAddress } from "../api";
import type { Agent, Approval, Wallet } from "../types";
import { useAppData } from "../appdata";
import { Alert, Empty, ErrorBlock, Loading, PageHeader, Panel, StatusBadge } from "../ui";
import { Link } from "../router";
import { formatTimestamp, timeAgo } from "../format";

interface Health {
  service?: string;
  status?: string;
  environment?: string;
  timestamp?: string;
  chain?: { configured?: boolean; submission?: string; chainHead?: number | null; indexerLag?: number | null };
  services?: Record<string, boolean>;
}

interface EventRow {
  id: string;
  ts: number;
  kind: string;
  decision?: string | null;
  reason?: string | null;
  agent_id?: string | null;
  amount?: string | null;
  wallet_id: string;
}

interface TransactionRow {
  id: string;
  wallet_id: string;
  tx_hash?: string | null;
  userop_hash?: string | null;
  recipient?: string;
  amount?: string;
  status: string;
  source?: string;
  created_at?: number;
}

function walletBalance(wallets: Wallet[]): string {
  if (wallets.length === 0 || wallets.some((wallet) => !wallet.balance || wallet.balance.symbol.toUpperCase() !== "USDC")) {
    return "—";
  }
  const balances = wallets.map((wallet) => wallet.balance!);
  const decimals = balances[0].decimals;
  if (balances.some((balance) => balance.decimals !== decimals)) return "Unavailable";
  try {
    const total = balances.reduce((sum, balance) => sum + BigInt(balance.atomic), 0n);
    return `${formatAtomic(total.toString(), decimals)} USDC`;
  } catch {
    return "Unavailable";
  }
}

export function Overview() {
  const { wallets, walletsLoading, walletsError, refresh } = useAppData();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [healthLoading, setHealthLoading] = useState(true);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [pendingCounts, setPendingCounts] = useState<Record<string, number>>({});
  const [pendingLoading, setPendingLoading] = useState(false);
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [eventsError, setEventsError] = useState("");
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);
  const [transactionsError, setTransactionsError] = useState("");

  useEffect(() => {
    let current = true;
    setHealthLoading(true);
    apiRequest<Health>("/health")
      .then((response) => { if (current) setHealth(response); })
      .catch((error: unknown) => { if (current) setHealthError(error instanceof Error ? error.message : "Service status could not be read."); })
      .finally(() => { if (current) setHealthLoading(false); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (walletsLoading) return;
    if (wallets.length === 0) { setTransactions([]); return; }
    let current = true;
    apiRequest<{ transactions?: TransactionRow[] }>("/transactions")
      .then((response) => { if (current) setTransactions((response.transactions ?? []).slice(0, 6)); })
      .catch((error: unknown) => { if (current) setTransactionsError(error instanceof Error ? error.message : "Transaction records could not be loaded."); })
      .finally(() => undefined);
    return () => { current = false; };
  }, [wallets, walletsLoading]);

  useEffect(() => {
    let current = true;
    apiRequest<{ agents: Agent[] }>("/agents")
      .then((response) => { if (current) setAgents(Array.isArray(response.agents) ? response.agents : []); })
      .catch((error: unknown) => { if (current) setAgentsError(error instanceof Error ? error.message : "Agent list could not be loaded."); });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (walletsLoading) return;
    if (wallets.length === 0) {
      setPendingCounts({});
      setEvents([]);
      setPendingLoading(false);
      return;
    }
    let current = true;
    setPendingLoading(true);
    setEvents(null);
    (async () => {
      const counts: Record<string, number> = {};
      const collected: EventRow[] = [];
      const failures = new Set<string>();
      await Promise.allSettled(wallets.slice(0, 12).map(async (wallet) => {
        try {
          const response = await apiRequest<{ approvals: Approval[] }>(`/approvals?walletId=${encodeURIComponent(wallet.id)}`);
          counts[wallet.id] = (response.approvals ?? []).filter((approval) => approval.status === "pending").length;
        } catch {
          counts[wallet.id] = -1;
          failures.add("approvals");
        }
        try {
          const response = await apiRequest<{ events: EventRow[] }>(`/events?walletId=${encodeURIComponent(wallet.id)}`);
          for (const event of response.events ?? []) collected.push({ ...event, wallet_id: wallet.id });
        } catch {
          failures.add("events");
        }
      }));
      if (!current) return;
      setPendingCounts(counts);
      collected.sort((left, right) => right.ts - left.ts);
      setEvents(collected.slice(0, 8));
      setEventsError(failures.has("events") ? "Some recent activity could not be loaded." : "");
      setPendingLoading(false);
    })();
    return () => { current = false; };
  }, [wallets, walletsLoading]);

  const pendingTotal = useMemo(() => {
    const values = Object.values(pendingCounts).filter((value) => value >= 0);
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
  }, [pendingCounts]);

  const alerts = useMemo(() => {
    const result: string[] = [];
    if (health?.status && health.status !== "ok") result.push(`The AEGIS service reports ${health.status}.`);
    if (health?.chain?.configured === false) result.push("Base Sepolia connectivity is not configured.");
    if (typeof health?.chain?.submission === "string" && health.chain.submission.startsWith("disabled")) {
      result.push("On-chain submission is currently unavailable.");
    }
    return result;
  }, [health]);

  const activeAgents = agents?.filter((agent) => agent.status === "active").length;
  const connectedServices = Object.values(health?.services ?? {}).filter(Boolean).length;
  const serviceCount = Object.keys(health?.services ?? {}).length;
  const walletReady = wallets.length > 0;
  const agentReady = (agents ?? []).some((agent) => agent.status === "active");
  const setupProgress = !walletsLoading && !walletsError && agents !== null && !agentsError && !(walletReady && agentReady)
    ? { walletReady, agentReady, percent: (Number(walletReady) + Number(agentReady)) * 50 }
    : null;

  return (
    <div className="page overview-page">
      <PageHeader
        title="Overview"
        description="Wallets, agents and approvals across your workspace."
        actions={<><Link to="/tasks" className="button button-primary">Assign a task</Link><button className="button button-secondary" type="button" onClick={refresh}>Refresh</button></>}
      />

      {walletsError && <ErrorBlock error={new Error(walletsError)} retry={refresh} />}
      {agentsError && <Alert kind="info">Agent records could not be loaded: {agentsError}</Alert>}
      {eventsError && <Alert kind="info">{eventsError}</Alert>}
      {transactionsError && <Alert kind="info">Transaction history could not be loaded: {transactionsError}</Alert>}

      {setupProgress && (
        <Panel className="onboarding-panel">
          <div className="onboarding-copy">
            <div className="setup-progress-heading">
              <h2>{setupProgress.walletReady ? "Your wallet is ready." : "Set up your workspace."}</h2>
              <strong>{setupProgress.percent}%</strong>
            </div>
            <p className="muted">{setupProgress.walletReady
              ? "Add an active agent to complete setup."
              : "Create a smart wallet, then authorize an agent to act within its limits."}</p>
            <div
              className="setup-progress-track"
              role="progressbar"
              aria-label="Wallet and agent setup"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={setupProgress.percent}
            >
              <span style={{ width: `${setupProgress.percent}%` }} />
            </div>
          </div>
          <ol className="onboarding-steps">
            <li className={setupProgress.walletReady ? "setup-step-complete" : ""}>
              <span aria-hidden="true">{setupProgress.walletReady ? "✓" : "1"}</span>
              <span><strong>Set up a smart wallet</strong><small>{setupProgress.walletReady ? "Ready" : "Create and deploy your wallet"}</small></span>
            </li>
            <li className={setupProgress.agentReady ? "setup-step-complete" : ""}>
              <span aria-hidden="true">{setupProgress.agentReady ? "✓" : "2"}</span>
              <span><strong>Authorize an agent</strong><small>{setupProgress.agentReady ? "Active agent enrolled" : "Connect an agent to your wallet"}</small></span>
            </li>
          </ol>
          <Link to={setupProgress.walletReady ? "/agents" : "/wallets"} className="button button-primary">
            {setupProgress.walletReady ? "Set up an agent" : "Create a wallet"}
          </Link>
        </Panel>
      )}

      <section className="stat-grid" aria-label="Workspace summary">
        <article className="stat-card">
          <span className="stat-label">Wallet balance</span>
          <strong className={`stat-value${!walletsLoading && walletBalance(wallets) === "—" ? " stat-value-empty" : " stat-value-balance"}`}>{walletsLoading ? "…" : walletBalance(wallets)}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Smart wallets</span>
          <strong className="stat-value">{walletsLoading ? "…" : walletsError ? "—" : wallets.length}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Active agents</span>
          <strong className="stat-value">{agents === null ? "…" : agentsError ? "—" : activeAgents}</strong>
        </article>
        <article className="stat-card">
          <span className="stat-label">Pending approvals</span>
          <strong className="stat-value">{pendingLoading && pendingTotal === null ? "…" : pendingTotal === null ? "—" : pendingTotal}</strong>
        </article>
      </section>

      <div className="overview-grid">
        <Panel className="overview-health">
          <div className="panel-top"><h2>Service status</h2>{health?.status && <StatusBadge status={health.status} />}</div>
          {healthLoading ? <Loading label="Checking service" /> : healthError ? <ErrorBlock error={new Error(healthError)} /> : (
            <div className="service-summary">
              <div className="service-line"><span>Environment</span><strong>{health?.environment ?? "Not reported"}</strong></div>
              <div className="service-line"><span>Base Sepolia</span><strong>{health?.chain?.configured ? "Connected" : health?.chain?.configured === false ? "Not configured" : "Status unavailable"}</strong></div>
              <div className="service-line"><span>Services ready</span><strong>{serviceCount > 0 ? `${connectedServices} of ${serviceCount}` : "Not reported"}</strong></div>
              <div className="service-line"><span>Last checked</span><strong>{health?.timestamp ? timeAgo(Date.parse(health.timestamp) / 1000) : "—"}</strong></div>
            </div>
          )}
          {alerts.length > 0 && <div className="service-alerts">{alerts.map((message) => <Alert key={message} kind="info">{message}</Alert>)}</div>}
        </Panel>

        <Panel className="overview-agents">
          <div className="panel-top"><h2>Agents</h2><Link to="/agents" className="text-button">View all</Link></div>
          {agents === null && !agentsError ? <Loading label="Loading agents" /> : agentsError ? <p className="muted">Agent records are unavailable right now.</p> : agents?.length === 0 ? (
            <Empty title="No agents yet" action={<Link to="/agents" className="button button-secondary">Create an agent</Link>}>Create an agent to work within a wallet and its owner-defined permissions.</Empty>
          ) : (
            <ul className="agent-preview-list">
              {agents?.slice(0, 4).map((agent, index) => {
                const walletId = agent.wallet_id ?? agent.walletId ?? "";
                const wallet = wallets.find((item) => item.id === walletId);
                return (
                  <li key={agent.id} className="agent-preview" style={{ ["--index" as string]: index }}>
                    <Link to={`/agents/${encodeURIComponent(agent.id)}`} className="agent-preview-main">
                      <span><strong>{agent.name}</strong><small>{wallet ? shortAddress(wallet.address) : "Wallet not available"}</small></span>
                    </Link>
                    <StatusBadge status={agent.status} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="overview-transactions">
          <div className="panel-top"><h2>Recent transactions</h2><Link to="/transactions" className="text-button">View all</Link></div>
          {transactions === null ? <Loading label="Loading transactions" /> : transactions.length === 0 ? (
            <Empty title="No transactions recorded">Confirmed and pending records appear when returned by the API.</Empty>
          ) : (
            <ul className="transaction-preview-list">
              {transactions.slice(0, 4).map((transaction) => (
                <li key={transaction.id}>
                  <div><strong>{transaction.amount ? `${formatAtomic(transaction.amount)} USDC` : "Payment"}</strong><small>To {shortAddress(transaction.recipient)} · {transaction.created_at ? timeAgo(transaction.created_at) : "Time unavailable"}</small></div>
                  <StatusBadge status={transaction.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="overview-events">
          <div className="panel-top"><h2>Recent activity</h2></div>
          {!events ? <Loading label="Loading activity" /> : events.length === 0 ? (
            <Empty title="No activity yet">Wallet and agent actions will appear here when recorded by the API.</Empty>
          ) : (
            <ul className="event-list">
              {events.slice(0, 4).map((event) => (
                <li key={event.id} className="event-row">
                  <div className="event-main"><strong className="event-kind">{event.kind.replace(/_/g, " ")}</strong><span className="muted small">{shortAddress(wallets.find((wallet) => wallet.id === event.wallet_id)?.address)}</span></div>
                  <div className="event-meta"><StatusBadge status={event.decision ?? undefined} /><span className="muted small num" title={formatTimestamp(event.ts)}>{timeAgo(event.ts)}</span></div>
                  {event.amount && <span className="event-amount num">{formatAtomic(event.amount)} USDC</span>}
                  {event.reason && <p className="muted small event-reason">{event.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
