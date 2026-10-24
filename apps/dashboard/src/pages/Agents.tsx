import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiError, apiRequest, errorMessage, formatAtomic, shortAddress } from "../api";
import type { Agent } from "../types";
import { useAppData } from "../appdata";
import { Alert, CopyButton, Empty, ErrorBlock, Loading, Modal, OwnerSignDialog, PageHeader, Panel, StatusBadge, type PreparedCall } from "../ui";
import { Link } from "../router";
import { explorerTxUrl, formatTimestamp, randomHexCredential, truncateMiddle } from "../format";

interface CreateAgentBody {
  walletId: string;
  name: string;
  sessionKeyAddress: string;
  authorizationTxHash: string;
  profile: "scripted-safe" | "scripted-adaptive";
  agentCredential: string;
}

function CreateAgentDialog({ open, onClose, wallets }: { open: boolean; onClose: () => void; wallets: Array<{ id: string; address: string; deployment_status?: string | null }> }) {
  const { refresh } = useAppData();
  const [walletId, setWalletId] = useState("");
  const [name, setName] = useState("");
  const [keyAddress, setKeyAddress] = useState("");
  const [txHash, setTxHash] = useState("");
  const [profile, setProfile] = useState<"scripted-safe" | "scripted-adaptive">("scripted-safe");
  const [credential, setCredential] = useState("");
  const [credentialRevealed, setCredentialRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [created, setCreated] = useState<Agent | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open && wallets.length > 0 && walletId === "") setWalletId(wallets[0].id);
  }, [open, wallets, walletId]);

  function reset() {
    setWalletId("");
    setName("");
    setKeyAddress("");
    setTxHash("");
    setProfile("scripted-safe");
    setCredential("");
    setCredentialRevealed(false);
    setError("");
    setIssues([]);
    setCreated(null);
    setStep(0);
    setBusy(false);
  }

  function close() {
    onClose();
    if (created) refresh();
    reset();
  }

  const deployableWallets = wallets.filter((wallet) => wallet.deployment_status === "deployed");

  function canContinue() {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return deployableWallets.some((wallet) => wallet.id === walletId);
    if (step === 2) return /^0x[0-9a-fA-F]{40}$/.test(keyAddress.trim()) && /^0x[0-9a-fA-F]{64}$/.test(txHash.trim());
    return true;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIssues([]);
    setBusy(true);
    const generated = randomHexCredential(32);
    setCredential(generated);
    try {
      const body: CreateAgentBody = {
        walletId,
        name: name.trim(),
        sessionKeyAddress: keyAddress.trim(),
        authorizationTxHash: txHash.trim(),
        profile,
        agentCredential: generated,
      };
      const response = await apiRequest<{ agent: Agent }>("/agents", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setCreated(response.agent);
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 400 && requestError.payload && typeof requestError.payload === "object") {
        const payload = requestError.payload as { issues?: Array<{ path?: string[]; message?: string }>; error?: string };
        if (Array.isArray(payload.issues)) {
          setIssues(payload.issues.map((issue) => `${(issue.path ?? []).join(".")}: ${issue.message ?? "invalid"}`));
        }
        setError(payload.error ?? errorMessage(requestError));
      } else {
        setError(errorMessage(requestError));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="Add agent">
      <div className="dialog-stack">
        {created ? (
          <>
            <Alert kind="success">
              Agent enrolled. The API stores only a peppered HMAC of the credential — plaintext is never returned or logged.
            </Alert>
            <dl className="kv-ledger">
              <div><dt>Agent ID</dt><dd><code>{created.id}</code> <CopyButton value={created.id} /></dd></div>
              <div><dt>Session key</dt><dd><code className="break-all">{created.session_key_address ?? created.sessionKeyAddress ?? "—"}</code></dd></div>
              <div><dt>Profile</dt><dd>{created.profile}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={created.status} /></dd></div>
            </dl>
            {!credentialRevealed && (
              <Alert kind="info">
                The agent credential is shown once. Copy it into the agent&apos;s environment now — it cannot be recovered later.
              </Alert>
            )}
            <div className="credential-row">
              <code className="break-all">{credentialRevealed ? credential : "•".repeat(24)}</code>
              <div className="row-actions">
                <CopyButton value={credential} label="Copy credential" />
                <button type="button" className="text-button" onClick={() => setCredentialRevealed(true)}>
                  {credentialRevealed ? "Hidden forever once you leave" : "Reveal"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <ol className="wizard-steps" aria-label="Agent setup steps">
              {["Identity", "Wallet", "Authorization", "Review"].map((label, index) => (
                <li key={label} className={index === step ? "wizard-step current" : index < step ? "wizard-step complete" : "wizard-step"}>
                  <span>{index < step ? "✓" : `0${index + 1}`}</span>{label}
                </li>
              ))}
            </ol>
            {error && <Alert>{error}</Alert>}
            {issues.length > 0 && (
              <Alert>
                <ul className="issue-list">
                  {issues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </Alert>
            )}
            <form className="form-stack" onSubmit={submit}>
              {step === 0 && <>
                <p className="muted">Give the agent a name and choose the execution profile supported by this API.</p>
                <label>Agent name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} autoFocus required placeholder="Research agent" /></label>
                <label>Execution profile<select value={profile} onChange={(event) => setProfile(event.target.value === "scripted-adaptive" ? "scripted-adaptive" : "scripted-safe")}><option value="scripted-safe">Careful · scripted safe</option><option value="scripted-adaptive">Adaptive · scripted adaptive</option></select><span className="field-help">Model selection is not supported by the current agent enrollment API.</span></label>
              </>}
              {step === 1 && <>
                <p className="muted">Choose a deployed Base Sepolia smart wallet. Each agent is attached to one wallet.</p>
                {deployableWallets.length === 0 ? <Alert kind="info">No deployed wallet is available. Deploy a wallet before enrolling an agent.</Alert> : (
                  <label>Smart wallet<select value={walletId} onChange={(event) => setWalletId(event.target.value)} required>{deployableWallets.map((wallet) => <option key={wallet.id} value={wallet.id}>{truncateMiddle(wallet.address, 10, 8)}</option>)}</select></label>
                )}
                {walletId && deployableWallets.find((wallet) => wallet.id === walletId) && <div className="wizard-summary"><span>NETWORK</span><strong>Base Sepolia · 84532</strong><code>{deployableWallets.find((wallet) => wallet.id === walletId)?.address}</code></div>}
              </>}
              {step === 2 && <>
                <p className="muted">The session public key must already be authorized by the wallet owner. Never paste a private key here.</p>
                <label>Session public address<input value={keyAddress} onChange={(event) => setKeyAddress(event.target.value)} placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" spellCheck={false} autoComplete="off" required /></label>
                <label>Confirmed KeyAdded transaction<input value={txHash} onChange={(event) => setTxHash(event.target.value)} placeholder="0x…" pattern="^0x[0-9a-fA-F]{64}$" spellCheck={false} autoComplete="off" required /><span className="field-help">The API verifies the on-chain authorization event and confirmation depth before enrollment.</span></label>
              </>}
              {step === 3 && <>
                <p className="muted">Review what will be enrolled. The on-chain key authorization must already be confirmed.</p>
                <dl className="kv-ledger wizard-summary-list">
                  <div><dt>Agent</dt><dd>{name || "—"} · {profile}</dd></div>
                  <div><dt>Wallet</dt><dd><code>{deployableWallets.find((wallet) => wallet.id === walletId)?.address ?? "—"}</code></dd></div>
                  <div><dt>Session key</dt><dd><code>{keyAddress || "—"}</code></dd></div>
                  <div><dt>Authorization record</dt><dd><code>{txHash || "—"}</code></dd></div>
                </dl>
                <p className="field-help">Enrollment records the agent after chain verification. Financial limits remain enforced by the wallet&apos;s on-chain policy.</p>
              </>}
              <div className="modal-actions-inline wizard-controls">
                {step > 0 && <button className="button button-secondary" type="button" onClick={() => setStep((current) => current - 1)}>Back</button>}
                {step < 3 ? <button className="button button-primary" type="button" disabled={!canContinue()} onClick={() => setStep((current) => current + 1)}>Continue <span aria-hidden="true">→</span></button> : <button className="button button-primary" type="submit" disabled={busy || !canContinue()}>{busy ? "Verifying enrollment…" : "Enroll agent"}</button>}
              </div>
            </form>
          </>
        )}
      </div>
    </Modal>
  );
}

export function Agents() {
  const { wallets, walletsLoading, walletsError } = useAppData();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [createFor, setCreateFor] = useState<string | null>(null);

  async function loadAgents() {
    try {
      const response = await apiRequest<{ agents: Agent[] }>("/agents");
      setAgents(Array.isArray(response.agents) ? response.agents : []);
      setAgentsError("");
    } catch (error) {
      setAgentsError(errorMessage(error));
    }
  }

  useEffect(() => {
    void loadAgents();
  }, []);

  const grouped = useMemo(() => {
    const byWallet = new Map<string, Agent[]>();
    for (const agent of agents ?? []) {
      const key = agent.wallet_id ?? agent.walletId ?? "";
      const list = byWallet.get(key) ?? [];
      list.push(agent);
      byWallet.set(key, list);
    }
    return byWallet;
  }, [agents]);

  return (
    <div className="page">
      <PageHeader
        title="Agents"
        description="Create agents that work inside an owner-authorized wallet and its on-chain policy."
        actions={
          <button
            className="button button-primary"
            type="button"
            disabled={wallets.length === 0}
            onClick={() => setCreateFor(wallets[0]?.id ?? null)}
          >
            Create agent
          </button>
        }
      />

      {walletsError && <Alert kind="info">{walletsError}</Alert>}
      {agentsError && <ErrorBlock error={new Error(agentsError)} retry={() => void loadAgents()} />}
      {agents === null && !agentsError && <Panel><Loading label="Loading agents" /></Panel>}

      {agents !== null && agents.length === 0 && !agentsError && (
        <Panel index={1}>
          <Empty
            title="No agents enrolled"
            action={wallets.length > 0 ? <button className="button button-primary" type="button" onClick={() => setCreateFor(wallets[0].id)}>Create an agent</button> : undefined}
          >
            Agents spend against policy using session keys scoped per wallet.
          </Empty>
        </Panel>
      )}

      {agents !== null && agents.length > 0 && (
        <div className="page-stack">
          {[...grouped.entries()].map(([walletId, list], index) => {
            const wallet = wallets.find((entry) => entry.id === walletId);
            return (
              <Panel key={walletId || index} index={index + 1}>
                <div className="panel-top">
                  <h2>{wallet ? <code title={wallet.address}>{truncateMiddle(wallet.address, 10, 8)}</code> : <span className="muted">Wallet {shortAddress(walletId)}</span>}</h2>
                  <button className="text-button" type="button" onClick={() => setCreateFor(walletId)}>Create agent</button>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Name</th><th>Status</th><th>Mode</th><th>Session key</th><th>Stopped</th><th>Added</th></tr>
                    </thead>
                    <tbody>
                      {list.map((agent) => (
                        <tr key={agent.id}>
                          <td><Link to={`/agents/${encodeURIComponent(agent.id)}`} className="row-link">{agent.name}</Link></td>
                          <td><StatusBadge status={agent.status} /></td>
                          <td>{agent.profile === "scripted-safe" ? "Careful" : agent.profile === "scripted-adaptive" ? "Adaptive" : agent.profile}</td>
                          <td><code title={agent.session_key_address ?? agent.sessionKeyAddress ?? ""}>{truncateMiddle(agent.session_key_address ?? agent.sessionKeyAddress, 10, 8)}</code></td>
                          <td>{agent.died_at ? formatTimestamp(agent.died_at) : "—"}</td>
                          <td className="num">{agent.created_at ? formatTimestamp(agent.created_at) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {walletsLoading && <Panel><Loading label="Loading wallets" /></Panel>}

      <CreateAgentDialog
        open={createFor !== null}
        onClose={() => setCreateFor(null)}
        wallets={wallets.map((wallet) => ({ id: wallet.id, address: wallet.address, deployment_status: wallet.deployment_status ?? wallet.deploymentStatus ?? null }))}
      />
    </div>
  );
}

export function AgentDetail({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [agentError, setAgentError] = useState("");
  const [agentLoading, setAgentLoading] = useState(true);
  const [policy, setPolicy] = useState<Record<string, unknown> | null>(null);
  const [policyError, setPolicyError] = useState("");
  const [events, setEvents] = useState<Array<Record<string, unknown>> | null>(null);
  const [eventsError, setEventsError] = useState("");
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeError, setRevokeError] = useState("");
  const [revokeCall, setRevokeCall] = useState<PreparedCall | null>(null);

  useEffect(() => {
    let current = true;
    setAgentLoading(true);
    apiRequest<{ agent: Agent }>(`/agents/${encodeURIComponent(agentId)}`)
      .then((response) => {
        if (!current) return;
        setAgent(response.agent);
        const walletId = response.agent.wallet_id ?? response.agent.walletId ?? "";
        const key = response.agent.session_key_address ?? response.agent.sessionKeyAddress ?? "";
        if (walletId && key) {
          apiRequest<Record<string, unknown>>(`/policy?walletId=${encodeURIComponent(walletId)}&keyAddress=${encodeURIComponent(key)}`)
            .then((policyResponse) => { if (current) { setPolicy(policyResponse); setPolicyError(""); } })
            .catch((policyRequestError: unknown) => {
              if (!current) return;
              if (policyRequestError instanceof ApiError && policyRequestError.status === 404) {
                setPolicy(null);
                setPolicyError("No policy cached for this session key yet.");
              } else {
                setPolicyError(errorMessage(policyRequestError));
              }
            });
        }
        if (walletId) {
          apiRequest<{ events: Array<Record<string, unknown>> }>(`/events?walletId=${encodeURIComponent(walletId)}`)
            .then((eventsResponse) => {
              if (!current) return;
              setEvents((eventsResponse.events ?? []).filter((event) => event.agent_id === agentId));
            })
            .catch((eventsRequestError: unknown) => { if (current) setEventsError(errorMessage(eventsRequestError)); });
        }
      })
      .catch((error: unknown) => { if (current) setAgentError(errorMessage(error)); })
      .finally(() => { if (current) setAgentLoading(false); });
    return () => { current = false; };
  }, [agentId]);

  async function revoke() {
    if (!agent) return;
    setRevokeBusy(true);
    setRevokeError("");
    try {
      const response = await apiRequest<{ call: PreparedCall; statusChangesOnlyAfter?: string }>(
        `/agents/${encodeURIComponent(agent.id)}/revoke`,
        { method: "POST", body: "{}" },
      );
      setRevokeCall(response.call);
      setRevokeOpen(true);
    } catch (error) {
      setRevokeError(errorMessage(error));
      setRevokeOpen(true);
    } finally {
      setRevokeBusy(false);
    }
  }

  if (agentLoading) return <Panel><Loading label="Loading agent" /></Panel>;
  if (agentError || !agent) {
    return (
      <div className="page">
        <PageHeader title="Agent" actions={<Link to="/agents" className="button button-secondary">All agents</Link>} />
        <ErrorBlock error={new Error(agentError || "Agent not found.")} retry={() => window.location.reload()} />
      </div>
    );
  }

  const walletId = agent.wallet_id ?? agent.walletId ?? "";
  const key = agent.session_key_address ?? agent.sessionKeyAddress ?? "";

  return (
    <div className="page">
      <PageHeader
        title={agent.name}
        description={`Agent · wallet ${shortAddress(walletId)}`}
        actions={<><Link to={`/tasks?agent=${encodeURIComponent(agent.id)}`} className="button button-primary">Assign task</Link><Link to="/agents" className="button button-secondary">All agents</Link></>}
      />

      <div className="bento">
        <Panel index={1} className="bento-health">
          <div className="panel-top">
            <h2>Overview</h2>
            <StatusBadge status={agent.status} />
          </div>
          <dl className="kv-ledger">
            <div><dt>Agent ID</dt><dd><code>{agent.id}</code> <CopyButton value={agent.id} /></dd></div>
            <div><dt>Wallet</dt><dd><code className="break-all">{walletId}</code></dd></div>
            <div><dt>Wallet address</dt><dd><code className="break-all">{agent.wallet_address ?? "—"}</code></dd></div>
            <div><dt>Session key</dt><dd><code className="break-all">{key || "—"}</code> {key && <CopyButton value={key} />}</dd></div>
            <div><dt>Mode</dt><dd>{agent.profile === "scripted-safe" ? "Careful" : agent.profile === "scripted-adaptive" ? "Adaptive" : agent.profile}</dd></div>
            <div><dt>Added</dt><dd>{agent.created_at ? formatTimestamp(agent.created_at) : "—"}</dd></div>
            {agent.died_at && <div><dt>Died</dt><dd>{formatTimestamp(agent.died_at)}{agent.death_cause ? ` · ${agent.death_cause}` : ""}</dd></div>}
          </dl>
          <div className="row-actions">
            <button className="button button-danger" type="button" disabled={revokeBusy} onClick={() => void revoke()}>
              {revokeBusy ? "Preparing…" : "Revoke session key"}
            </button>
          </div>
          {revokeError && <Alert>{revokeError}</Alert>}
        </Panel>

        <Panel index={2} className="bento-counts">
          <div className="panel-top"><h2>Policy</h2></div>
          {policyError && <Alert kind="info">{policyError}</Alert>}
          {policy ? (
            <>
              <dl className="kv-ledger">
                <div><dt>Version</dt><dd className="num">{String(policy.version ?? "—")}</dd></div>
                <div><dt>Policy hash</dt><dd><code className="break-all">{String(policy.policyHash ?? "—")}</code></dd></div>
                <div><dt>Tx</dt><dd>{explorerTxUrl(typeof policy.txHash === "string" ? policy.txHash : null) ? <a href={explorerTxUrl(String(policy.txHash))!} target="_blank" rel="noreferrer" className="text-button">View ↗</a> : <code className="muted">none</code>}</dd></div>
                <div><dt>Created</dt><dd>{typeof policy.createdAt === "number" ? formatTimestamp(policy.createdAt) : "—"}</dd></div>
              </dl>
              <details>
                <summary>Policy JSON</summary>
                <pre className="json-block">{JSON.stringify(policy.policy, null, 2)}</pre>
              </details>
            </>
          ) : !policyError ? <Loading label="Loading policy" /> : null}
        </Panel>

        <Panel index={3} className="bento-events">
          <div className="panel-top"><h2>Activity</h2></div>
          {eventsError && <ErrorBlock error={new Error(eventsError)} />}
          {!events && !eventsError && <Loading label="Loading activity" />}
          {events && events.length === 0 && <Empty title="No activity for this agent">Events are recorded when the agent acts through the gateway.</Empty>}
          {events && events.length > 0 && (
            <ul className="event-list">
              {events.slice().reverse().slice(0, 10).map((event, index) => (
                <li key={String(event.id ?? index)} className="event-row">
                  <div className="event-main">
                    <span className="event-kind">{String(event.kind ?? "event").replace(/_/g, " ")}</span>
                    {typeof event.amount === "string" && (
                      <span className="num">{formatAtomic(event.amount)} USDC</span>
                    )}
                  </div>
                  <div className="event-meta">
                    <StatusBadge status={typeof event.decision === "string" ? event.decision : undefined} />
                    <span className="muted small num">{formatTimestamp(Number(event.ts))}</span>
                  </div>
                  {typeof event.reason === "string" && <p className="muted small event-reason">{event.reason}</p>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <OwnerSignDialog
        open={revokeOpen}
        onClose={() => { setRevokeOpen(false); setRevokeError(""); }}
        call={revokeCall}
        title="Revoke session key"
        contextNote="Revocation takes effect only after the confirmed KeyRevoked event. Until then the key can still sign user operations."
      />
    </div>
  );
}
