import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ApprovalCard,
  Badge,
  Button,
  Card,
  DecisionMark,
  Dialog,
  EventDrawer,
  LedgerTable,
  PolicyPanel,
  StatusMark,
} from "../components";
import { decide, isMockMode } from "../lib/api";
import "../styles/dashboard.css";
import type {
  AegisEvent,
  AgentSummary,
  AuditDecision,
  PendingRequest,
  Policy,
  WalletSummary,
} from "../lib/types";

interface DashboardSectionsProps {
  section: string;
  wallet: WalletSummary;
  policy: Policy;
  pending: PendingRequest[];
  events: AegisEvent[];
  audit: AuditDecision[];
  agents: AgentSummary[];
  onRefresh: () => void;
  onPausedChange: (paused: boolean) => Promise<void>;
  onRevoked: () => Promise<void>;
  ownerAddress: string;
  ownerChainId: number | null;
}

type Preview = "wallet" | "agent" | "send" | "receive" | null;

const currency = (value: string) =>
  `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const shortAddress = (value: string) =>
  value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
const readableDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};
const statusTone = (value: string) =>
  ["executed", "approved", "active", "live"].includes(value)
    ? "good"
    : ["blocked", "denied", "revoked", "offline"].includes(value)
      ? "bad"
      : "wait";

function downloadFile(name: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function DashboardSections({
  section,
  wallet,
  policy,
  pending,
  events,
  audit,
  agents,
  onRefresh,
  onPausedChange,
  onRevoked,
  ownerAddress,
  ownerChainId,
}: DashboardSectionsProps) {
  const navigate = useNavigate();
  const mock = isMockMode;
  const [preview, setPreview] = useState<Preview>(null);
  const [logQuery, setLogQuery] = useState("");
  const [logDecision, setLogDecision] = useState("all");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(wallet.keyStatus === "paused");
  useEffect(() => {
    if (wallet.keyStatus !== "revoked") setPaused(wallet.keyStatus === "paused");
  }, [wallet.keyStatus]);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<AegisEvent | null>(null);
  const [recipientInput, setRecipientInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [recipientError, setRecipientError] = useState("");
  const [amountError, setAmountError] = useState("");
  const [copied, setCopied] = useState(false);
  const [walletSearch, setWalletSearch] = useState("");
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [agentTab, setAgentTab] = useState("Overview");
  const recipientInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  const currentSection = section.trim().toLowerCase();
  const titleBySection: Record<string, string> = {
    overview: "Overview",
    wallets: "Wallets",
    agents: "Agents",
    transactions: "Transactions",
    approvals: "Approvals",
    security: "Security",
    settings: "Settings",
    audit: "Audit trail",
    logs: "Event logs",
  };
  const pageTitle = titleBySection[currentSection] ?? "Overview";
  const remainingToday = Math.max(0, Number(policy.dailyLimit) - Number(policy.usedToday));
  const filteredEvents = events.filter((event) => {
    const matchesDecision = logDecision === "all" || event.decision === logDecision;
    const haystack = [
      event.timestamp,
      event.environment,
      event.agentId,
      event.action,
      event.target,
      event.amount,
      event.decision,
      event.rule,
      event.reason,
      event.txHash,
      event.userOpHash,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesDecision && haystack.includes(logQuery.trim().toLowerCase());
  });

  async function updatePaused(nextPaused: boolean) {
    if (!mock || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onPausedChange(nextPaused);
      setPaused(nextPaused);
      setNotice(
        `Demo-only: session key ${nextPaused ? "paused" : "resumed"}. No on-chain transaction was sent.`,
      );
      onRefresh();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not update the demo session state.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey() {
    if (!mock || busy) return;
    setBusy(true);
    setNotice("");
    try {
      await onRevoked();
      setConfirmRevoke(false);
      setNotice("Demo-only: session key marked revoked. No on-chain transaction was sent.");
      onRefresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not revoke the demo session key.");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRequest(id: string, action: "approve_once" | "approve_and_allow" | "deny") {
    if (busy) return;
    if (!mock) {
      setNotice(
        "Unavailable: owner browser-wallet signing is not connected. No approval was submitted.",
      );
      return;
    }
    setBusy(true);
    setNotice("");
    try {
      await decide(id, action);
      setNotice(
        `Demo-only: request ${action === "deny" ? "denied" : "approved"}. No chain transaction was sent.`,
      );
      onRefresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update this demo request.");
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  function exportLogs(format: "csv" | "json") {
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === "json") {
      downloadFile(
        `aegis-events-${stamp}.json`,
        JSON.stringify(filteredEvents, null, 2),
        "application/json",
      );
      return;
    }
    const columns: Array<keyof AegisEvent> = [
      "timestamp",
      "environment",
      "agentId",
      "action",
      "target",
      "amount",
      "decision",
      "rule",
      "reason",
      "txHash",
      "userOpHash",
    ];
    const rows = [
      columns.map(csvCell).join(","),
      ...filteredEvents.map((event) => columns.map((column) => csvCell(event[column])).join(",")),
    ];
    downloadFile(`aegis-events-${stamp}.csv`, rows.join("\r\n"), "text/csv;charset=utf-8");
  }

  const heading = (eyebrow: string, title: string, description?: string) => (
    <div className="ds-heading">
      <p className="ds-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      {description && <p className="ds-muted">{description}</p>}
    </div>
  );
  const panel = (children: ReactNode, className = "") => (
    <Card className={`ds-panel ${className}`}>{children}</Card>
  );
  const pill = (label: string, tone = "neutral") => (
    <Badge className={`ds-pill ds-pill-${tone}`}>{label}</Badge>
  );
  const actionButton = (
    label: string,
    onClick: () => void,
    variant = "quiet",
    disabled = false,
  ) => (
    <Button
      className={`ds-button ds-button-${variant}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {label}
    </Button>
  );
  const modeNotice = (
    <div className={`ds-mode-banner ${mock ? "is-demo" : "is-live"}`} role="status">
      <span className="ds-mode-mark" aria-hidden="true">
        {mock ? "D" : "!"}
      </span>
      <div>
        <strong>{mock ? "Demo mode" : "Signing is not connected"}</strong>
        <p>
          {mock
            ? "Actions on this screen change mock data only. No funds move and no transaction is sent."
            : "Wallet actions are unavailable until browser-wallet signing is connected. Nothing here can submit an on-chain transaction."}
        </p>
      </div>
    </div>
  );

  function renderWalletCard() {
    return panel(
      <>
        <div className="ds-panel-topline">
          <div>
            <p className="ds-eyebrow">POLICY WALLET</p>
            <h3>{wallet.name}</h3>
          </div>
          <StatusMark status={wallet.keyStatus} />
        </div>
        <p className="ds-eyebrow">
          {mock ? "SAMPLE SMART-ACCOUNT ADDRESS" : "SMART-ACCOUNT ADDRESS"}
        </p>
        <p className="ds-address" title={wallet.address}>
          {wallet.address}
        </p>
        <div className="ds-balance-grid">
          <div>
            <span>{mock ? "Sample USDC balance" : "Reported USDC balance"}</span>
            <strong>{currency(wallet.usdcBalance)}</strong>
          </div>
          <div>
            <span>{mock ? "Sample ETH balance" : "Reported ETH balance"}</span>
            <strong>
              {wallet.ethBalance} <small>ETH</small>
            </strong>
          </div>
        </div>
        <div className="ds-inline-meta">
          <span>
            {wallet.deployed
              ? "Deployment reported by data source"
              : "Counterfactual address · not deployed"}
          </span>
          <span>{wallet.agentCount} linked agents</span>
          {wallet.chainId && <span>Chain {wallet.chainId}</span>}
        </div>
        <div className="ds-assigned-agents">
          <span>Assigned agents</span>
          {agents
            .filter((agent) => agent.walletId === wallet.id)
            .map((agent) => (
              <span key={agent.id}>{agent.name}</span>
            ))}
          {!agents.some((agent) => agent.walletId === wallet.id) && <span>None assigned</span>}
        </div>
        <div className="ds-actions">
          {actionButton("Send preview", () => setPreview("send"))}
          {actionButton("Receive preview", () => setPreview("receive"))}
          <a
            className="ds-explorer-link"
            href={`https://sepolia.basescan.org/address/${wallet.address}`}
            rel="noreferrer"
            target="_blank"
          >
            {mock ? "Open sample address on Basescan" : "Open address on Basescan"}
          </a>
        </div>
        {!wallet.deployed && (
          <p className="ds-muted">
            Do not fund this counterfactual sample until a supported smart-account deployment is
            verified.
          </p>
        )}
      </>,
      "ds-wallet-card",
    );
  }

  function renderOverview() {
    return (
      <>
        <section className="ds-metrics" aria-label="Wallet and policy summary">
          <Card className="ds-metric ds-metric-dark">
            <span>{mock ? "Sample USDC balance" : "Reported USDC balance"}</span>
            <strong>{currency(wallet.usdcBalance)}</strong>
            <small>
              {mock ? "Mock data · not verified on-chain" : "Reported by the configured API"}
            </small>
          </Card>
          <Card className="ds-metric">
            <span>Daily budget remaining</span>
            <strong>{currency(String(remainingToday))}</strong>
            <small>
              {currency(policy.usedToday)} used of {currency(policy.dailyLimit)}
            </small>
          </Card>
          <Card className="ds-metric">
            <span>Awaiting review</span>
            <strong>{String(pending.length).padStart(2, "0")}</strong>
            <small>Owner approval requests</small>
          </Card>
          <Card className="ds-metric">
            <span>Connected agents</span>
            <strong>
              {String(agents.filter((agent) => agent.status !== "revoked").length).padStart(2, "0")}
            </strong>
            <small>Across this policy wallet</small>
          </Card>
        </section>
        <nav aria-label="Quick actions" className="ds-quick-actions">
          {actionButton("Create wallet preview", () => setPreview("wallet"))}
          {actionButton("Create agent preview", () => setPreview("agent"))}
          {actionButton("Send preview", () => setPreview("send"))}
          {actionButton("Review approvals", () => navigate("/app/approvals"))}
        </nav>
        <div className="ds-overview-grid">
          <div className="ds-overview-main">
            {renderWalletCard()}
            {panel(
              <>
                <div className="ds-panel-topline">
                  <div>
                    <p className="ds-eyebrow">RECENT ACTIVITY</p>
                    <h3>Policy decisions</h3>
                  </div>
                  {pill(`${events.length} events`)}
                </div>
                {events.length ? (
                  <div className="ds-event-list">
                    {events.slice(0, 5).map((event, index) => (
                      <button
                        className="ds-event-row"
                        key={`${event.timestamp}-${event.agentId}-${index}`}
                        onClick={() => setSelectedEvent(event)}
                        type="button"
                      >
                        <span
                          className={`ds-event-dot ds-event-dot-${statusTone(event.decision)}`}
                          aria-hidden="true"
                        />
                        <div className="ds-event-copy">
                          <strong>{event.action}</strong>
                          <span>
                            {event.agentId} · {readableDate(event.timestamp)} ·{" "}
                            {event.rule?.replaceAll("_", " ") ?? "no rule reported"}
                          </span>
                        </div>
                        <span className="ds-event-amount">{currency(event.amount)}</span>
                        <DecisionMark decision={event.decision} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="ds-empty">No policy events have been recorded.</p>
                )}
              </>,
              "ds-activity-panel",
            )}
          </div>
          <aside className="ds-overview-side">
            {panel(
              <>
                <div className="ds-panel-topline">
                  <div>
                    <p className="ds-eyebrow">POLICY HEALTH</p>
                    <h3>Spending boundary</h3>
                  </div>
                  <StatusMark status={wallet.keyStatus} />
                </div>
                <PolicyPanel className="ds-policy-summary" policy={policy} title="Current policy" />
              </>,
              "ds-policy-card",
            )}
            {panel(
              <>
                <div className="ds-panel-topline">
                  <div>
                    <p className="ds-eyebrow">OWNER QUEUE</p>
                    <h3>Needs your review</h3>
                  </div>
                  {pill(`${pending.length} pending`, pending.length ? "wait" : "good")}
                </div>
                {pending.length ? (
                  pending.slice(0, 3).map((request) => (
                    <div className="ds-queue-row" key={request.id}>
                      <strong>{request.action}</strong>
                      <span>
                        {request.agentId} · {currency(request.amount)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="ds-empty">No requests are waiting.</p>
                )}
                {pending.length > 0 && (
                  <p className="ds-card-footnote">
                    Review actions are{" "}
                    {mock ? "demo-only" : "unavailable pending browser-wallet signing"}.
                  </p>
                )}
              </>,
              "ds-queue-card",
            )}
          </aside>
        </div>
      </>
    );
  }

  function renderWallets() {
    const wallets = [wallet].filter((item) =>
      `${item.name} ${item.address}`.toLowerCase().includes(walletSearch.trim().toLowerCase()),
    );
    return (
      <>
        <div className="ds-section-intro">
          {heading(
            "01 / CUSTODY",
            "Wallets",
            mock
              ? "Sample balances and key state only. No wallet activity is verified on-chain."
              : "Balances and key state reported by the configured API.",
          )}
          {actionButton("＋ New wallet", () => setPreview("wallet"), "accent")}
        </div>
        <label className="ds-search">
          <span className="ds-sr-only">Search wallets</span>
          <span aria-hidden="true">⌕</span>
          <input
            onChange={(event) => setWalletSearch(event.target.value)}
            placeholder="Search wallet name or address"
            type="search"
            value={walletSearch}
          />
        </label>
        {wallets.length ? (
          <>
            <div className="ds-two-col">
              {renderWalletCard()}
              {panel(
                <>
                  <p className="ds-eyebrow">TRANSFER TOOL</p>
                  <h3>Move assets</h3>
                  <p className="ds-muted">
                    Build a local preview of transfer details. This page has no wallet SDK or
                    transaction API, so it cannot submit, sign, or confirm a transfer.
                  </p>
                  <div className="ds-actions ds-actions-stacked">
                    {actionButton("Prepare send preview", () => setPreview("send"), "accent")}
                    {actionButton("Show receive details", () => setPreview("receive"))}
                  </div>
                </>,
                "ds-transfer-card",
              )}
            </div>
            {panel(
              <>
                <p className="ds-eyebrow">FUNDING INSTRUCTIONS</p>
                <h3>Use Base Sepolia test assets only</h3>
                <p className="ds-muted">
                  The sample account is counterfactual and not deployed. Do not fund it. For a
                  deployed account, first verify its address and deployment on Base Sepolia, then
                  use a test ETH faucet for gas and a test USDC faucet for tokens.
                </p>
                <div className="ds-actions">
                  <a
                    className="ds-explorer-link"
                    href="https://www.alchemy.com/faucets/base-sepolia"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Base Sepolia ETH faucet
                  </a>
                  <a
                    className="ds-explorer-link"
                    href="https://faucet.circle.com/"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open Circle testnet USDC faucet
                  </a>
                </div>
              </>,
              "ds-funding-panel",
            )}
            <PolicyPanel
              className="ds-wallet-policy"
              policy={policy}
              title="Wallet policy overview"
            />
          </>
        ) : (
          panel(
            <p className="ds-empty">
              No wallets match this search. Clear the search or create a wallet preview.
            </p>,
          )
        )}
        {panel(
          <>
            <div className="ds-panel-topline">
              <div>
                <p className="ds-eyebrow">WALLET CONTROL</p>
                <h3>Session key</h3>
              </div>
              {pill(wallet.keyStatus, statusTone(wallet.keyStatus))}
            </div>
            <p className="ds-muted">
              Pause or revoke the agent session key. In demo mode these controls only alter local
              mock state; real signing controls are not connected.
            </p>
            <div className="ds-actions">
              {actionButton(
                paused ? "Resume session key" : "Pause session key",
                () => void updatePaused(!paused),
                "quiet",
                !mock || busy || wallet.keyStatus === "revoked",
              )}
              {actionButton(
                "Revoke key",
                () => setConfirmRevoke(true),
                "danger",
                !mock || busy || wallet.keyStatus === "revoked",
              )}
            </div>
          </>,
          "ds-key-panel",
        )}
      </>
    );
  }

  function renderAgents() {
    const agent = agents.find((item) => item.id === selectedAgentId);
    if (agent) {
      const agentEvents = events.filter((event) => event.agentId === agent.id);
      const detailTabs = ["Overview", "Policies", "Activity", "Security"];
      return (
        <>
          <div className="ds-section-intro">
            {heading("02 / AGENT DETAIL", agent.name, agent.purpose)}
            {actionButton("Back to agents", () => setSelectedAgentId(""))}
          </div>
          <div
            aria-label="Agent detail sections"
            className="ds-tabs"
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              const current = detailTabs.indexOf(agentTab);
              const next =
                detailTabs[(current + direction + detailTabs.length) % detailTabs.length];
              setAgentTab(next);
              document.getElementById(`agent-tab-${next.toLowerCase()}`)?.focus();
            }}
            role="tablist"
          >
            {detailTabs.map((tab) => (
              <button
                aria-selected={agentTab === tab}
                className={agentTab === tab ? "is-selected" : ""}
                id={`agent-tab-${tab.toLowerCase()}`}
                key={tab}
                onClick={() => setAgentTab(tab)}
                role="tab"
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>
          <section
            aria-labelledby={`agent-tab-${agentTab.toLowerCase()}`}
            className="ds-agent-detail"
            role="tabpanel"
          >
            {agentTab === "Overview" && (
              <>
                <div className="ds-setting-row">
                  <span>Lifecycle status</span>
                  {pill(agent.status, statusTone(agent.status))}
                </div>
                <div className="ds-setting-row">
                  <span>Model</span>
                  <strong>{agent.model}</strong>
                </div>
                <div className="ds-setting-row">
                  <span>Assigned wallet</span>
                  <code>{shortAddress(wallet.address)}</code>
                </div>
                <div className="ds-setting-row">
                  <span>Purpose</span>
                  <strong>{agent.purpose}</strong>
                </div>
              </>
            )}
            {agentTab === "Policies" && (
              <>
                <div className="ds-setting-row">
                  <span>Per-transaction limit</span>
                  <strong>{currency(agent.perTransactionLimit)}</strong>
                </div>
                <div className="ds-setting-row">
                  <span>Daily budget</span>
                  <strong>{currency(agent.dailyLimit)}</strong>
                </div>
                <div className="ds-rule-groups">
                  <div>
                    <span>Allowed recipients</span>
                    {policy.recipients.map((item) => (
                      <code key={item}>{shortAddress(item)}</code>
                    ))}
                  </div>
                  <div>
                    <span>Allowed contracts</span>
                    {policy.contracts.map((item) => (
                      <code key={item}>{shortAddress(item)}</code>
                    ))}
                  </div>
                  <div>
                    <span>Allowed functions</span>
                    {policy.functions.map((item) => (
                      <code key={item}>{item}</code>
                    ))}
                  </div>
                </div>
              </>
            )}
            {agentTab === "Activity" && (
              <LedgerTable
                caption={`${agent.name} decision history`}
                events={agentEvents}
                onEventSelect={setSelectedEvent}
              />
            )}
            {agentTab === "Security" && (
              <>
                <div className="ds-setting-row">
                  <span>Session-key authorization</span>
                  <strong>Not provisioned in this frontend</strong>
                </div>
                <div className="ds-setting-row">
                  <span>Key status</span>
                  <StatusMark status={wallet.keyStatus} />
                </div>
                <div className="ds-setting-row">
                  <span>Risk history</span>
                  <strong>
                    {agentEvents.filter((event) => event.decision === "blocked").length} blocked
                    policy checks in sample data
                  </strong>
                </div>
                <p className="ds-inline-disclaimer">
                  No private key or signing permission is stored or created here.
                </p>
              </>
            )}
          </section>
        </>
      );
    }
    const filteredAgents = agents.filter((item) =>
      `${item.name} ${item.purpose} ${item.model} ${item.id}`
        .toLowerCase()
        .includes(agentSearch.trim().toLowerCase()),
    );
    return (
      <>
        <div className="ds-section-intro">
          {heading(
            "02 / ROSTER",
            "Agents",
            "Review each agent identity and its assigned spending boundary.",
          )}
          {actionButton("＋ Create agent", () => setPreview("agent"), "accent")}
        </div>
        <label className="ds-search">
          <span className="ds-sr-only">Search agents</span>
          <span aria-hidden="true">⌕</span>
          <input
            onChange={(event) => setAgentSearch(event.target.value)}
            placeholder="Search agent, purpose, or model"
            type="search"
            value={agentSearch}
          />
        </label>
        <div className="ds-agent-grid">
          {filteredAgents.map((agent, index) => (
            <Card className="ds-panel ds-agent-card" key={agent.id}>
              <div className="ds-agent-card-head">
                <span className="ds-agent-index">{String(index + 1).padStart(2, "0")}</span>
                {pill(agent.status, statusTone(agent.status))}
              </div>
              <h3>{agent.name}</h3>
              <p className="ds-agent-purpose">{agent.purpose}</p>
              <div className="ds-agent-model">
                <span>MODEL</span>
                <strong>{agent.model}</strong>
              </div>
              <div className="ds-policy-line">
                <span>Per transaction</span>
                <strong>{currency(agent.perTransactionLimit)}</strong>
              </div>
              <div className="ds-policy-line">
                <span>Daily limit</span>
                <strong>{currency(agent.dailyLimit)}</strong>
              </div>
              <div className="ds-inline-meta">
                <span>Wallet {shortAddress(agent.walletId)}</span>
                <span>ID {agent.id}</span>
              </div>
              {actionButton("Open agent details", () => {
                setSelectedAgentId(agent.id);
                setAgentTab("Overview");
              })}
            </Card>
          ))}
        </div>
        {!filteredAgents.length &&
          panel(
            <p className="ds-empty">
              No agents match this search. Clear the search or create an agent preview.
            </p>,
          )}
        <p className="ds-inline-disclaimer">
          Agent creation is a preview only. The SDK/API needed to provision an agent or grant
          permissions is absent.
        </p>
      </>
    );
  }

  function renderTransactions() {
    return (
      <>
        {heading(
          "03 / EXECUTION RECORD",
          "Transactions",
          "Policy checks and transaction references reported to Aegis. An “executed” event is not independently verified on-chain here.",
        )}
        {panel(
          <>
            <div className="ds-panel-topline">
              <div>
                <p className="ds-eyebrow">EVENT STREAM</p>
                <h3>All activity</h3>
              </div>
              {pill(`${events.length} records`)}
            </div>
            <LedgerTable
              caption="Transaction and policy event history"
              events={events}
              onEventSelect={setSelectedEvent}
            />
          </>,
        )}
      </>
    );
  }

  function renderApprovals() {
    return (
      <>
        {heading(
          "04 / OWNER IN THE LOOP",
          "Approvals",
          mock
            ? "Exceptions are surfaced for review. Review actions below are mock-only."
            : "Exceptions are surfaced for review. Submitting approvals requires owner wallet signing, which is not connected.",
        )}
        {pending.length ? (
          <div className="ds-approval-list">
            {pending.map((request) => (
              <ApprovalCard
                className="ds-approval-card"
                disabled={!mock || busy}
                key={request.id}
                onAction={(action, selected) => void reviewRequest(selected.id, action)}
                request={request}
              />
            ))}
          </div>
        ) : (
          panel(
            <div className="ds-empty-state">
              <span className="ds-empty-glyph" aria-hidden="true">
                ✓
              </span>
              <h3>Queue is clear</h3>
              <p>No pending approval requests.</p>
            </div>,
          )
        )}
      </>
    );
  }

  function renderSecurity() {
    return (
      <>
        {heading(
          "05 / CONTROL PLANE",
          "Security",
          "Inspect the policy boundary and manage the agent session key.",
        )}
        <div className="ds-security-grid">
          {panel(
            <>
              <div className="ds-panel-topline">
                <div>
                  <p className="ds-eyebrow">SESSION AUTHORITY</p>
                  <h3>Agent access</h3>
                </div>
                {pill(wallet.keyStatus, statusTone(wallet.keyStatus))}
              </div>
              <p className="ds-muted">
                Wallet {shortAddress(wallet.address)} · {agents.length} registered agents
              </p>
              <label className="ds-toggle-row">
                <span>
                  <strong>Pause agent activity</strong>
                  <small>Stops use of the session key in this application.</small>
                </span>
                <input
                  aria-label="Pause agent activity"
                  checked={paused}
                  disabled={!mock || busy || wallet.keyStatus === "revoked"}
                  onChange={(event) => void updatePaused(event.target.checked)}
                  type="checkbox"
                />
              </label>
              {!mock && (
                <p className="ds-inline-disclaimer">
                  Unavailable: browser-wallet signing has not been connected.
                </p>
              )}
              <div className="ds-danger-zone">
                <div>
                  <strong>Revoke session key</strong>
                  <p>This is intended to permanently disable the current session permission.</p>
                </div>
                {actionButton(
                  "Revoke key",
                  () => setConfirmRevoke(true),
                  "danger",
                  !mock || busy || wallet.keyStatus === "revoked",
                )}
              </div>
            </>,
          )}
          {panel(
            <>
              <p className="ds-eyebrow">POLICY LIMITS</p>
              <h3>Enforced envelope</h3>
              <div className="ds-policy-line">
                <span>Per transaction</span>
                <strong>{currency(policy.perTransactionLimit)}</strong>
              </div>
              <div className="ds-policy-line">
                <span>Daily maximum</span>
                <strong>{currency(policy.dailyLimit)}</strong>
              </div>
              <div className="ds-policy-line">
                <span>Used today</span>
                <strong>{currency(policy.usedToday)}</strong>
              </div>
              <div className="ds-policy-line">
                <span>Expires</span>
                <strong>{readableDate(policy.expiresAt)}</strong>
              </div>
              <div className="ds-rule-groups">
                <div>
                  <span>Recipients</span>
                  {policy.recipients.length ? (
                    policy.recipients.map((item) => <code key={item}>{shortAddress(item)}</code>)
                  ) : (
                    <small>None restricted</small>
                  )}
                </div>
                <div>
                  <span>Contracts</span>
                  {policy.contracts.length ? (
                    policy.contracts.map((item) => <code key={item}>{shortAddress(item)}</code>)
                  ) : (
                    <small>None restricted</small>
                  )}
                </div>
                <div>
                  <span>Functions</span>
                  {policy.functions.length ? (
                    policy.functions.map((item) => <code key={item}>{item}</code>)
                  ) : (
                    <small>None restricted</small>
                  )}
                </div>
              </div>
            </>,
          )}
          {panel(
            <>
              <p className="ds-eyebrow">EXPLAINABLE RULE TRACE</p>
              <h3>Recent policy decisions</h3>
              {events
                .filter((event) => event.rule)
                .slice(0, 5)
                .map((event, index) => (
                  <div className="ds-policy-line" key={`${event.timestamp}-${index}`}>
                    <span>
                      {event.action} · {event.agentId}
                    </span>
                    <strong>
                      {event.rule?.replaceAll("_", " ")}: {event.decision}
                    </strong>
                  </div>
                ))}
              {!events.some((event) => event.rule) && (
                <p className="ds-empty">No rule traces are available.</p>
              )}
            </>,
          )}
        </div>
      </>
    );
  }

  function renderSettings() {
    return (
      <>
        {heading(
          "06 / CONFIGURATION",
          "Settings",
          "Application-level status and policy configuration. Editing and chain submission are not available in this build.",
        )}
        <div className="ds-settings-grid">
          {panel(
            <>
              <p className="ds-eyebrow">ENVIRONMENT</p>
              <h3>{mock ? "Local mock data" : "Connected API"}</h3>
              <p className="ds-muted">
                {mock
                  ? "The dashboard is backed by in-memory sample state. Changes reset when the page or mock service restarts."
                  : "This dashboard can read from the configured API. Wallet-signing controls remain unavailable."}
              </p>
              {pill(mock ? "DEMO" : "API", mock ? "wait" : "good")}
            </>,
          )}
          {panel(
            <>
              <p className="ds-eyebrow">WALLET PROFILE</p>
              <h3>{wallet.name}</h3>
              <div className="ds-setting-row">
                <span>Address</span>
                <code>{wallet.address}</code>
              </div>
              <div className="ds-setting-row">
                <span>Chain</span>
                <strong>{wallet.chainId ?? "Not reported"}</strong>
              </div>
              <div className="ds-setting-row">
                <span>Deployment</span>
                <strong>{wallet.deployed ? "Reported deployed" : "Not deployed"}</strong>
              </div>
            </>,
          )}
          {panel(
            <>
              <p className="ds-eyebrow">POLICY PROFILE</p>
              <h3>Current limits</h3>
              <div className="ds-setting-row">
                <span>Per-transaction cap</span>
                <strong>{currency(policy.perTransactionLimit)}</strong>
              </div>
              <div className="ds-setting-row">
                <span>Daily cap</span>
                <strong>{currency(policy.dailyLimit)}</strong>
              </div>
              <div className="ds-setting-row">
                <span>Allowlisted recipients</span>
                <strong>{policy.recipients.length}</strong>
              </div>
              <div className="ds-setting-row">
                <span>Allowed contracts</span>
                <strong>{policy.contracts.length}</strong>
              </div>
            </>,
          )}
          {panel(
            <>
              <p className="ds-eyebrow">DATA</p>
              <h3>Refresh dashboard</h3>
              <p className="ds-muted">
                Reload wallet, policy, requests, agents, activity, and audit state from the
                application data source.
              </p>
              {actionButton("Refresh data", onRefresh, "accent")}
            </>,
          )}
        </div>
      </>
    );
  }

  function renderAudit() {
    return (
      <>
        {heading(
          "07 / ACCOUNTABILITY",
          "Audit trail",
          "Owner decisions and their recorded outcomes.",
        )}
        {panel(
          <>
            <div className="ds-panel-topline">
              <div>
                <p className="ds-eyebrow">DECISION RECORD</p>
                <h3>Review history</h3>
              </div>
              {pill(`${audit.length} entries`)}
            </div>
            <div aria-label="Owner decisions" className="ds-table-wrap" role="region" tabIndex={0}>
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Action</th>
                    <th>Outcome</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td>{readableDate(entry.timestamp)}</td>
                      <td>{entry.actor}</td>
                      <td>
                        <strong>{entry.action}</strong>
                      </td>
                      <td>{pill(entry.outcome, statusTone(entry.outcome))}</td>
                      <td>{entry.detail}</td>
                    </tr>
                  ))}
                  {!audit.length && (
                    <tr>
                      <td className="ds-table-empty" colSpan={5}>
                        No owner decisions recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>,
        )}
      </>
    );
  }

  function renderLogs() {
    return (
      <>
        {heading(
          "08 / OBSERVABILITY",
          "Event logs",
          "Search every available event field, narrow by decision, then export the current filtered result set.",
        )}
        {panel(
          <>
            <div className="ds-log-tools">
              <label className="ds-search">
                <span className="ds-sr-only">Search logs</span>
                <span aria-hidden="true">⌕</span>
                <input
                  onChange={(event) => setLogQuery(event.target.value)}
                  placeholder="Search action, agent, address, rule..."
                  type="search"
                  value={logQuery}
                />
              </label>
              <label className="ds-filter">
                <span className="ds-sr-only">Filter by decision</span>
                <select
                  onChange={(event) => setLogDecision(event.target.value)}
                  value={logDecision}
                >
                  <option value="all">All decisions</option>
                  <option value="executed">Executed</option>
                  <option value="blocked">Blocked</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="denied">Denied</option>
                </select>
              </label>
              {actionButton("Export CSV", () => exportLogs("csv"))}
              {actionButton("Export JSON", () => exportLogs("json"))}
            </div>
            <div className="ds-log-summary">
              <span>
                {filteredEvents.length} of {events.length} events
              </span>
              <span>Exports include filtered rows only</span>
            </div>
            <div
              aria-label="Filtered event log"
              className="ds-table-wrap"
              role="region"
              tabIndex={0}
            >
              <table className="ds-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Environment</th>
                    <th>Agent</th>
                    <th>Action</th>
                    <th>Target / rule</th>
                    <th>Amount</th>
                    <th>Decision</th>
                    <th>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event, index) => (
                    <tr key={`${event.timestamp}-${event.agentId}-${index}`}>
                      <td>{readableDate(event.timestamp)}</td>
                      <td>{event.environment}</td>
                      <td>{event.agentId}</td>
                      <td>
                        <strong>{event.action}</strong>
                        {event.reason && <small>{event.reason}</small>}
                      </td>
                      <td>
                        <code>{shortAddress(event.target)}</code>
                        {event.rule && <small>{event.rule}</small>}
                      </td>
                      <td>{currency(event.amount)}</td>
                      <td>{pill(event.decision, statusTone(event.decision))}</td>
                      <td>
                        <code>
                          {event.txHash
                            ? shortAddress(event.txHash)
                            : event.userOpHash
                              ? shortAddress(event.userOpHash)
                              : "—"}
                        </code>
                      </td>
                    </tr>
                  ))}
                  {!filteredEvents.length && (
                    <tr>
                      <td className="ds-table-empty" colSpan={8}>
                        No events match this search and filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>,
        )}
      </>
    );
  }

  const views: Record<string, () => ReactNode> = {
    overview: renderOverview,
    wallets: renderWallets,
    agents: renderAgents,
    transactions: renderTransactions,
    approvals: renderApprovals,
    security: renderSecurity,
    settings: renderSettings,
    audit: renderAudit,
    logs: renderLogs,
  };
  const content = (views[currentSection] ?? renderOverview)();

  function submitWizard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(
      "Preview only: no wallet or agent was created. The required SDK/API is not available.",
    );
    setPreview(null);
  }

  function checkTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRecipientError("");
    setAmountError("");
    const amount = Number(amountInput);
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipientInput.trim())) {
      setRecipientError("Enter a valid 20-byte EVM address.");
    }
    if (!/^\d+(\.\d{1,6})?$/.test(amountInput) || !Number.isFinite(amount) || amount <= 0) {
      setAmountError("Enter a positive USDC amount with no more than 6 decimal places.");
    }
    const recipientValid = /^0x[a-fA-F0-9]{40}$/.test(recipientInput.trim());
    const amountValid =
      /^\d+(\.\d{1,6})?$/.test(amountInput) && Number.isFinite(amount) && amount > 0;
    if (!recipientValid || !amountValid) {
      if (!recipientValid) recipientInputRef.current?.focus();
      else amountInputRef.current?.focus();
      return;
    }
    const rule =
      amount > Number(policy.perTransactionLimit)
        ? "per-transaction limit"
        : amount > remainingToday
          ? "remaining daily limit"
          : amount > Number(wallet.usdcBalance)
            ? "available sample balance"
            : !policy.recipients.some(
                  (recipient) => recipient.toLowerCase() === recipientInput.trim().toLowerCase(),
                )
              ? "recipient allowlist"
              : "";
    setNotice(
      rule
        ? `Demo policy preview: this request would be held by the ${rule}. Gas availability and chain state cannot be verified here; no transaction was sent.`
        : "Demo policy preview: this request matches the displayed policy, but no transaction was signed or sent.",
    );
  }

  async function copyReceiveAddress() {
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setNotice("Wallet address copied. This sample address is not a verified smart account.");
    } catch {
      setCopied(false);
      setNotice("Could not copy the address. Select and copy it manually.");
    }
  }

  return (
    <main className="dashboard-sections">
      <header className="ds-top">
        <div>
          <p className="ds-eyebrow">AEGIS / CONTROL ROOM</p>
          <h1>
            {pageTitle}
            <span aria-hidden="true">.</span>
          </h1>
        </div>
        <div className="ds-top-right">
          {pill(mock ? "DEMO DATA" : "API CONNECTED", mock ? "wait" : "good")}
          {actionButton("Refresh", onRefresh)}
        </div>
      </header>
      {modeNotice}
      {notice && (
        <p className="ds-notice" role="status">
          {notice}
        </p>
      )}
      <div className="ds-content">{content}</div>

      <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      <Dialog
        className="ds-modal-dialog"
        labelledBy="ds-modal-title"
        onClose={() => setPreview(null)}
        open={Boolean(preview)}
      >
        <section className="ds-modal">
          <div className="ds-modal-head">
            <div>
              <p className="ds-eyebrow">
                {preview === "send" || preview === "receive" ? "TRANSFER PREVIEW" : "SETUP WIZARD"}
              </p>
              <h2 id="ds-modal-title">
                {
                  {
                    wallet: "Create wallet",
                    agent: "Configure agent",
                    send: "Send preview",
                    receive: "Receive details",
                  }[preview ?? "wallet"]
                }
              </h2>
            </div>
            <button
              aria-label="Close dialog"
              className="ds-close"
              onClick={() => setPreview(null)}
              type="button"
            >
              ×
            </button>
          </div>
          {preview === "wallet" || preview === "agent" ? (
            <>
              <p className="ds-modal-copy">
                Fill in a local setup preview. This does not create an identity, deploy a wallet,
                assign a key, or write settings.
              </p>
              <div className="ds-preview-callout">
                {mock ? "DEMO ONLY · " : "UNAVAILABLE · "}The SDK/API required to provision{" "}
                {preview === "wallet" ? "a wallet" : "an agent"} is absent.{" "}
                {mock
                  ? "Nothing will be saved or sent."
                  : "Real setup controls remain unavailable pending browser-wallet signing."}
              </div>
              {preview === "wallet" && (
                <ol className="ds-setup-steps">
                  <li>
                    {ownerAddress
                      ? `Owner connected: ${shortAddress(ownerAddress)}`
                      : "Connect the owner wallet from the dashboard header."}
                  </li>
                  <li>
                    {ownerChainId === 84532
                      ? "Base Sepolia chain ID 84532 verified in the browser wallet."
                      : ownerChainId
                        ? `Wrong chain (${ownerChainId}); switch to chain ID 84532.`
                        : "Chain ID cannot be verified until an owner wallet is connected."}
                  </li>
                  <li>
                    ERC-4337 preparation and deployment are unavailable because no smart-account SDK
                    is installed.
                  </li>
                </ol>
              )}
              <form className="ds-form" onSubmit={submitWizard}>
                <label>
                  {preview === "wallet" ? "Wallet name" : "Agent name"}
                  <input
                    placeholder={preview === "wallet" ? "Operations wallet" : "Procurement agent"}
                    required
                  />
                </label>
                {preview === "agent" && (
                  <>
                    <label>
                      Purpose
                      <input placeholder="What should this agent do?" required />
                    </label>
                    <label>
                      OpenRouter model
                      <select defaultValue="openai/gpt-oss-20b">
                        <option value="openai/gpt-oss-20b">gpt-oss (OpenRouter)</option>
                        <option value="scripted">Scripted agent</option>
                      </select>
                    </label>
                    <label>
                      Instructions
                      <textarea placeholder="Describe the agent's task and constraints." rows={3} />
                    </label>
                    <label>
                      Wallet assignment
                      <select defaultValue={wallet.id}>
                        <option value={wallet.id}>{wallet.name}</option>
                      </select>
                    </label>
                    <label>
                      Tools
                      <input placeholder="e.g. search, mock x402 API" />
                    </label>
                    <label>
                      Allowed recipients
                      <input placeholder="Comma-separated 0x addresses" />
                    </label>
                    <label>
                      Allowed contracts and selectors
                      <input placeholder="Contract address · function selector" />
                    </label>
                    <label>
                      Per-transaction limit (USDC)
                      <input inputMode="decimal" placeholder="25.00" />
                    </label>
                    <label>
                      Daily budget (USDC)
                      <input inputMode="decimal" placeholder="100.00" />
                    </label>
                    <label>
                      Gas cap
                      <input inputMode="decimal" placeholder="Not configured" />
                    </label>
                    <label>
                      Permission expiry
                      <input type="datetime-local" />
                    </label>
                    <p className="ds-inline-disclaimer">
                      Restricted session-key authorization, OpenRouter provisioning, and persistence
                      are not connected.
                    </p>
                  </>
                )}
                <div className="ds-actions">
                  {actionButton("Cancel", () => setPreview(null))}
                  <Button className="ds-button ds-button-accent" type="submit">
                    Preview setup only
                  </Button>
                </div>
              </form>
            </>
          ) : preview === "send" ? (
            <>
              <p className="ds-modal-copy">
                Review transfer details locally. This page cannot request a signature, send a
                transaction, or confirm settlement.
              </p>
              <div className="ds-preview-detail">
                <span>From</span>
                <code>{shortAddress(wallet.address)}</code>
              </div>
              <form className="ds-form" onSubmit={checkTransfer}>
                <label>
                  Recipient address
                  <input
                    aria-describedby="recipient-error"
                    aria-invalid={Boolean(recipientError)}
                    autoComplete="off"
                    onChange={(event) => {
                      setRecipientInput(event.target.value);
                      setRecipientError("");
                    }}
                    placeholder="0x followed by 40 hex characters"
                    ref={recipientInputRef}
                    value={recipientInput}
                  />
                </label>
                <p className="ds-form-error" id="recipient-error" role="alert">
                  {recipientError}
                </p>
                <label>
                  USDC amount
                  <input
                    aria-describedby="amount-error"
                    aria-invalid={Boolean(amountError)}
                    inputMode="decimal"
                    onChange={(event) => {
                      setAmountInput(event.target.value);
                      setAmountError("");
                    }}
                    placeholder="0.00"
                    ref={amountInputRef}
                    value={amountInput}
                  />
                </label>
                <p className="ds-form-error" id="amount-error" role="alert">
                  {amountError}
                </p>
                <p className="ds-inline-disclaimer">
                  Owner-directed preview. Agent-initiated transfers use a restricted session key.
                  Gas need and current chain balance cannot be verified from this frontend.
                </p>
                <div className="ds-preview-callout">
                  {mock ? "DEMO PREVIEW · " : "NOT CONNECTED · "}No wallet SDK or transfer API is
                  present. No funds will move.
                </div>
                <div className="ds-actions">
                  <Button className="ds-button ds-button-accent" type="submit">
                    Check policy preview
                  </Button>
                  {actionButton("Close preview", () => setPreview(null))}
                </div>
              </form>
            </>
          ) : (
            <>
              <p className="ds-modal-copy">
                Use the address below as a receive destination. No deposit is initiated or monitored
                by this preview.
              </p>
              <div className="ds-preview-detail">
                <span>Wallet address</span>
                <code>{wallet.address}</code>
              </div>
              <div className="ds-preview-detail">
                <span>Chain</span>
                <strong>{wallet.chainId ?? "Not reported by API"}</strong>
              </div>
              <p className="ds-inline-disclaimer">
                Receive instructions are valid only after the account address and deployment are
                verified on Base Sepolia.
              </p>
              <div className="ds-preview-callout">
                Display only. This page cannot generate a QR code or confirm an incoming transfer.
              </div>
              <div className="ds-actions">
                <Button
                  className="ds-button ds-button-accent"
                  onClick={() => void copyReceiveAddress()}
                  type="button"
                >
                  {copied ? "Address copied" : "Copy address"}
                </Button>
              </div>
              <div className="ds-actions">
                {actionButton("Close preview", () => setPreview(null), "accent")}
              </div>
            </>
          )}
        </section>
      </Dialog>

      <Dialog
        alert
        className="ds-modal-dialog"
        describedBy="ds-revoke-description"
        labelledBy="ds-revoke-title"
        onClose={() => setConfirmRevoke(false)}
        open={confirmRevoke}
      >
        <section className="ds-modal">
          <div className="ds-modal-head">
            <div>
              <p className="ds-eyebrow">IRREVERSIBLE CONTROL</p>
              <h2 id="ds-revoke-title">Revoke session key?</h2>
            </div>
            <button
              aria-label="Close dialog"
              className="ds-close"
              onClick={() => setConfirmRevoke(false)}
              type="button"
            >
              ×
            </button>
          </div>
          <p className="ds-modal-copy" id="ds-revoke-description">
            This marks the agent session key revoked in{" "}
            {mock ? "mock state only" : "the application API"}. It does not revoke an on-chain
            permission from this screen.
          </p>
          <div className="ds-preview-callout">
            {mock
              ? "DEMO ONLY · No on-chain transaction will be sent."
              : "Unavailable · Browser-wallet signing is not connected."}
          </div>
          <div className="ds-actions">
            <Button autoFocus onClick={() => setConfirmRevoke(false)} variant="secondary">
              Cancel
            </Button>
            <Button disabled={!mock || busy} onClick={() => void revokeKey()} variant="danger">
              Revoke in demo
            </Button>
          </div>
        </section>
      </Dialog>
    </main>
  );
}
