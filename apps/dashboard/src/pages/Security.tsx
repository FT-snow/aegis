import { useEffect, useMemo, useState } from "react";
import { apiRequest, formatAtomic } from "../api";
import type { Agent, Wallet } from "../types";
import { useAppData } from "../appdata";
import { Alert, Empty, ErrorBlock, Loading, OwnerSignDialog, PageHeader, Panel, StatusBadge, type PreparedCall } from "../ui";
import { Link } from "../router";
import { explorerTxUrl, formatTimestamp, truncateMiddle } from "../format";
import { functionSelector } from "../keccak";

interface TraceRule {
  id: string;
  status: string;
  severity: string;
  expected: string;
  observed: string;
  explanation: string;
}

interface RiskRecord {
  score?: number;
  level?: string;
  action?: string;
  restrictionProposal?: { perTxLimit: string; dailyLimit: string; suspendedUntil: number; freezeAgent: boolean } | null;
  advisory?: boolean;
  factors?: Array<{ id: string; points: number; evidence: string }>;
}

interface EventRow {
  id: string;
  ts: number;
  kind: string;
  decision?: string | null;
  rule?: string | null;
  reason?: string | null;
  agent_id?: string | null;
  trace_json?: string | null;
  passport_hash?: string | null;
}

interface WalletEventBundle {
  wallet: Wallet;
  events: EventRow[];
  error: string | null;
}

function parseTrace(raw: string | null | undefined): { rules: TraceRule[]; risk: RiskRecord | null; effective: Record<string, unknown> | null } {
  if (typeof raw !== "string" || raw.length === 0) return { rules: [], risk: null, effective: null };
  try {
    const parsed = JSON.parse(raw) as {
      policyEvaluation?: { trace?: TraceRule[] };
      risk?: RiskRecord;
      effectiveLimits?: Record<string, unknown>;
    };
    return {
      rules: parsed.policyEvaluation?.trace ?? [],
      risk: parsed.risk ?? null,
      effective: parsed.effectiveLimits ?? null,
    };
  } catch {
    return { rules: [], risk: null, effective: null };
  }
}

export function Security() {
  const { wallets, walletsLoading, walletsError } = useAppData();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [policies, setPolicies] = useState<Array<{ agent: Agent; walletId: string; policy: Record<string, unknown> | null; error: string | null }>>([]);
  const [bundles, setBundles] = useState<WalletEventBundle[]>([]);
  const [bundleLoading, setBundleLoading] = useState(true);
  const [revokeCall, setRevokeCall] = useState<PreparedCall | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeNote, setRevokeNote] = useState("");
  const [revokeBusyId, setRevokeBusyId] = useState("");
  const [pauseCall, setPauseCall] = useState<PreparedCall | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseNote, setPauseNote] = useState("");

  useEffect(() => {
    let current = true;
    apiRequest<{ agents: Agent[] }>("/agents")
      .then((response) => { if (current) setAgents(Array.isArray(response.agents) ? response.agents : []); })
      .catch((error: unknown) => { if (current) setAgentsError(error instanceof Error ? error.message : "Agent list failed"); });
    return () => { current = false; };
  }, []);

  // Policy history: the API returns the latest cached policy per (wallet, key).
  useEffect(() => {
    if (!agents) return;
    let current = true;
    (async () => {
      const rows: Array<{ agent: Agent; walletId: string; policy: Record<string, unknown> | null; error: string | null }> = [];
      await Promise.allSettled(agents.map(async (agent) => {
        const walletId = agent.wallet_id ?? agent.walletId ?? "";
        const key = agent.session_key_address ?? agent.sessionKeyAddress ?? "";
        if (!walletId || !key) return;
        try {
          const policy = await apiRequest<Record<string, unknown>>(
            `/policy?walletId=${encodeURIComponent(walletId)}&keyAddress=${encodeURIComponent(key)}`,
          );
          rows.push({ agent, walletId, policy, error: null });
        } catch (error) {
          const message = error instanceof Error ? error.message : "policy fetch failed";
          rows.push({ agent, walletId, policy: null, error: message });
        }
      }));
      if (current) setPolicies(rows);
    })();
    return () => { current = false; };
  }, [agents]);

  // Events per wallet feed the rule traces and risk restriction states.
  useEffect(() => {
    if (walletsLoading) return;
    let current = true;
    setBundleLoading(true);
    (async () => {
      const collected: WalletEventBundle[] = [];
      await Promise.allSettled(wallets.slice(0, 12).map(async (wallet: Wallet) => {
        try {
          const response = await apiRequest<{ events: EventRow[] }>(`/events?walletId=${encodeURIComponent(wallet.id)}`);
          if (current) collected.push({ wallet, events: response.events ?? [], error: null });
        } catch (error) {
          if (current) collected.push({ wallet, events: [], error: error instanceof Error ? error.message : "events failed" });
        }
      }));
      if (current) {
        setBundles(collected);
        setBundleLoading(false);
      }
    })();
    return () => { current = false; };
  }, [wallets, walletsLoading]);

  async function revokeAgent(agent: Agent) {
    setRevokeBusyId(agent.id);
    try {
      const response = await apiRequest<{ call: PreparedCall }>(`/agents/${encodeURIComponent(agent.id)}/revoke`, {
        method: "POST",
        body: "{}",
      });
      setRevokeCall(response.call);
      setRevokeNote(`Revoke ${agent.name}'s session key. Status changes only after the confirmed KeyRevoked event.`);
      setRevokeOpen(true);
    } catch {
      // Surfaced by the dialog being unable to open is not enough; show inline.
      setRevokeNote("Revoke failed — the API could not build the calldata.");
      setRevokeOpen(true);
    } finally {
      setRevokeBusyId("");
    }
  }

  function buildPauseCalldata(wallet: Wallet, pause: boolean) {
    // pause() and unpause() take no arguments; the account itself is the call target.
    const selector = functionSelector(pause ? "pause()" : "unpause()");
    setPauseCall({ to: wallet.address, value: "0", data: selector });
    setPauseNote(
      `${pause ? "Pause" : "Unpause"} wallet ${truncateMiddle(wallet.address, 10, 8)}. Calldata built locally from the AegisAccount ABI — nothing was submitted. While paused, no agent session key can act.`,
    );
    setPauseOpen(true);
  }

  const traces = useMemo(() => {
    const rows: Array<{ event: EventRow; wallet: Wallet; rules: TraceRule[] }> = [];
    for (const bundle of bundles) {
      for (const event of bundle.events) {
        const { rules } = parseTrace(event.trace_json);
        if (rules.length > 0) rows.push({ event, wallet: bundle.wallet, rules });
      }
    }
    return rows.reverse().slice(0, 6);
  }, [bundles]);

  const riskStates = useMemo(() => {
    const rows: Array<{ event: EventRow; wallet: Wallet; risk: RiskRecord | null; effective: Record<string, unknown> | null }> = [];
    for (const bundle of bundles) {
      for (const event of bundle.events) {
        if (event.kind !== "gateway_intent") continue;
        const { risk, effective } = parseTrace(event.trace_json);
        rows.push({ event, wallet: bundle.wallet, risk, effective });
      }
    }
    return rows.reverse().slice(0, 10);
  }, [bundles]);

  return (
    <div className="page">
      <PageHeader
        title="Security"
        description="Session keys, owner calldata builders, policy state, and risk restrictions."
      />

      {walletsError && <Alert kind="info">{walletsError}</Alert>}
      {agentsError && <ErrorBlock error={new Error(agentsError)} />}

      <div className="bento">
        <Panel className="bento-health" index={1}>
          <div className="panel-top"><h2>Session keys</h2>{agents && <span className="muted small num">{agents.length} total</span>}</div>
          {agents === null && !agentsError && <Loading label="Loading keys" />}
          {agents !== null && agents.length === 0 && (
            <Empty title="No session keys" action={<Link to="/agents" className="button button-secondary">Add an agent</Link>}>
              Each agent holds one session key scoped by the wallet&apos;s policy.
            </Empty>
          )}
          {agents !== null && agents.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agent</th><th>Wallet</th><th>Key</th><th>Status</th><th>Revoke</th></tr></thead>
                <tbody>
                  {agents.map((agent) => {
                    const wallet = wallets.find((entry) => entry.id === (agent.wallet_id ?? agent.walletId));
                    return (
                      <tr key={agent.id}>
                        <td><Link to={`/agents/${encodeURIComponent(agent.id)}`} className="row-link">{agent.name}</Link></td>
                        <td><code>{wallet ? truncateMiddle(wallet.address, 8, 6) : shortWallet(agent.wallet_id ?? agent.walletId)}</code></td>
                        <td><code title={agent.session_key_address ?? agent.sessionKeyAddress ?? ""}>{truncateMiddle(agent.session_key_address ?? agent.sessionKeyAddress, 8, 6)}</code></td>
                        <td><StatusBadge status={agent.status} /></td>
                        <td>
                          <button
                            className="button button-small button-danger"
                            type="button"
                            disabled={agent.status !== "active" || revokeBusyId === agent.id}
                            onClick={() => void revokeAgent(agent)}
                          >
                            {revokeBusyId === agent.id ? "…" : "Revoke"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel className="bento-counts" index={2}>
          <div className="panel-top"><h2>Pause / unpause</h2></div>
          <p className="muted small">
            Builds owner calldata for the account&apos;s pause() and unpause() selectors. No API endpoint performs this — the calldata is
            constructed locally from the AegisAccount ABI. Signing happens only in your wallet.
          </p>
          {wallets.length === 0 && !walletsLoading && <p className="muted small">No wallets to act on.</p>}
          <ul className="simple-list">
            {wallets.map((wallet) => (
              <li key={wallet.id} className="pause-row">
                <code>{truncateMiddle(wallet.address, 8, 6)}</code>
                <div className="row-actions">
                  <button className="button button-small button-danger" type="button" onClick={() => buildPauseCalldata(wallet, true)}>Pause</button>
                  <button className="button button-small button-secondary" type="button" onClick={() => buildPauseCalldata(wallet, false)}>Unpause</button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel className="bento-alerts" index={3}>
          <div className="panel-top"><h2>Policies</h2><span className="muted small">Latest version per session key</span></div>
          {policies.length === 0 && agents !== null && agents.length > 0 && <Loading label="Reading policies" />}
          {policies.length === 0 && agents !== null && agents.length === 0 && <p className="muted small">No session keys yet.</p>}
          {policies.map((row) => (
            <div key={row.agent.id} className="policy-block">
              <p>
                <strong>{row.agent.name}</strong> <span className="muted small">· wallet {shortWallet(row.walletId)}</span>
              </p>
              {row.error ? (
                <p className="muted small">{row.error}</p>
              ) : row.policy ? (
                <p className="small">
                  v{String(row.policy.version ?? "?")} · <code>{truncateMiddle(String(row.policy.policyHash ?? ""), 8, 6)}</code>
                  {" "}
                  {explorerTxUrl(typeof row.policy.txHash === "string" ? row.policy.txHash : null) && (
                    <a className="text-button" href={explorerTxUrl(String(row.policy.txHash))!} target="_blank" rel="noreferrer">setPolicy tx ↗</a>
                  )}
                </p>
              ) : (
                <p className="muted small">No cached policy.</p>
              )}
            </div>
          ))}
        </Panel>

        <Panel className="bento-events" index={4}>
          <div className="panel-top"><h2>Rule traces</h2><span className="muted small">From decision passports on recent intents</span></div>
          {bundleLoading && <Loading label="Loading traces" />}
          {!bundleLoading && traces.length === 0 && (
            <Empty title="No rule traces yet">Traces appear when agents submit intents through the gateway.</Empty>
          )}
          {traces.map(({ event, wallet, rules }) => (
            <div key={event.id} className="trace-block">
              <p className="trace-head">
                <strong>{event.kind.replace(/_/g, " ")}</strong>
                <span className="muted small"> · wallet {truncateMiddle(wallet.address, 6, 4)} · {formatTimestamp(event.ts)}</span>
              </p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Rule</th><th>Status</th><th>Severity</th><th>Expected</th><th>Observed</th></tr></thead>
                  <tbody>
                    {rules.map((rule) => (
                      <tr key={`${event.id}:${rule.id}`}>
                        <td><code>{rule.id}</code></td>
                        <td><StatusBadge status={rule.status} /></td>
                        <td>{rule.severity}</td>
                        <td className="small">{rule.expected}</td>
                        <td className="small num">{rule.observed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <details>
                <summary>Raw trace JSON</summary>
                <pre className="json-block">{event.trace_json}</pre>
              </details>
            </div>
          ))}
        </Panel>

        <Panel className="bento-services" index={5}>
          <div className="panel-top"><h2>Risk restrictions</h2><span className="muted small">Proposed vs effective</span></div>
          {bundleLoading && <Loading label="Loading risk states" />}
          {!bundleLoading && riskStates.length === 0 && (
            <Empty title="No risk activity">Restriction states appear in gateway intent records once agents act.</Empty>
          )}
          {riskStates.map(({ event, risk, effective }) => (
            <div key={event.id} className="risk-row">
              <div className="risk-head">
                <span className="event-kind">{event.kind.replace(/_/g, " ")}</span>
                <StatusBadge status={event.decision ?? undefined} />
                <span className="muted small num">{formatTimestamp(event.ts)}</span>
              </div>
              {risk && (
                <dl className="kv-ledger">
                  <div><dt>ARE action</dt><dd>{risk.action ?? "—"}</dd></div>
                  <div><dt>Score</dt><dd className="num">{risk.score ?? "—"}{risk.level ? ` · ${risk.level}` : ""}</dd></div>
                  {risk.restrictionProposal ? (
                    <div>
                      <dt>Proposed restriction</dt>
                      <dd className="small num">
                        {formatAtomic(risk.restrictionProposal.perTxLimit)} / tx · {formatAtomic(risk.restrictionProposal.dailyLimit)} daily
                        {risk.restrictionProposal.freezeAgent ? " · freeze" : ""}
                        {risk.restrictionProposal.suspendedUntil > 0 ? ` · suspend until ${formatTimestamp(risk.restrictionProposal.suspendedUntil)}` : ""}
                        <span className="badge badge-warn">proposal only</span>
                      </dd>
                    </div>
                  ) : (
                    <div><dt>Proposed restriction</dt><dd className="small">none — advisory only, no restriction proposed</dd></div>
                  )}
                  {effective && (
                    <div>
                      <dt>Effective limits</dt>
                      <dd className="small num">
                        {effective.perTxLimit ? `${formatAtomic(String(effective.perTxLimit))} / tx` : "policy limits"}
                        {effective.dailyLimit ? ` · ${formatAtomic(String(effective.dailyLimit))} daily` : ""}
                        {effective.frozen ? <span className="badge badge-bad">frozen</span> : null}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {!risk && <p className="muted small">No risk record in this event&apos;s trace.</p>}
            </div>
          ))}
        </Panel>
      </div>

      <OwnerSignDialog
        open={revokeOpen}
        onClose={() => { setRevokeOpen(false); setRevokeNote(""); }}
        call={revokeCall}
        title="Revoke session key"
        contextNote={revokeNote || undefined}
      />
      <OwnerSignDialog
        open={pauseOpen}
        onClose={() => { setPauseOpen(false); setPauseNote(""); }}
        call={pauseCall}
        title={pauseNote.startsWith("Pause ") ? "Pause wallet" : "Unpause wallet"}
        contextNote={pauseNote || undefined}
      />
    </div>
  );
}

function shortWallet(value: string | null | undefined): string {
  if (typeof value !== "string") return "—";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
